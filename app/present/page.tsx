'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnnotationLayer } from '@/components/AnnotationLayer';
import { CaptionBand } from '@/components/CaptionBand';
import { SlideCanvas, type SlideRect } from '@/components/SlideCanvas';
import { getBus, type BusMessage } from '@/lib/bus';
import { openDeck, PageRenderer, type Deck } from '@/lib/pdf';
import { attachHotkeys, type Command } from '@/lib/hotkeys';
import { uid } from '@/lib/speech/types';
import type { PresentationState, Shape } from '@/lib/types';

const EMPTY: PresentationState = {
  slideIndex: 0,
  slideCount: 0,
  captions: {
    layout: 'reserve',
    fontSize: 40,
    bandHeight: 22,
    color: '#ffffff',
    background: 'rgba(0,0,0,0.62)',
    visible: true,
    showAudience: true,
  },
  shapes: [],
  shapeKind: 'rect',
  shapeColor: 'rgba(250, 204, 21, 0.35)',
  status: 'idle',
  captionLine: null,
};

/**
 * Окно Presentation — то, что расшаривается в Teams. Ничего лишнего:
 * только слайд, разметка, субтитры и точка состояния (§14.8).
 *
 * Тупой рендерер: своего состояния не держит, всё получает снимком
 * от Control. Единственное отступление — ловит указатель для разметки
 * и сообщает Control, что нарисовано (§6а).
 */
export default function PresentPage() {
  const [state, setState] = useState<PresentationState>(EMPTY);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [renderer, setRenderer] = useState<PageRenderer | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState<SlideRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [idle, setIdle] = useState(false);
  const bus = useRef(getBus());
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.body.dataset.window = 'present';
    return () => {
      delete document.body.dataset.window;
    };
  }, []);

  // Начальная синхронизация: без неё перезагрузка окна посреди встречи
  // оставила бы его в дефолтном состоянии (§1).
  useEffect(() => {
    const off = bus.current.on((m: BusMessage) => {
      if (m.type === 'state') setState(m.payload);
    });
    bus.current.send({ type: 'hello' });
    const retry = setInterval(() => {
      if (state.slideCount === 0) bus.current.send({ type: 'hello' });
    }, 1500);
    return () => {
      off();
      clearInterval(retry);
    };
  }, [state.slideCount]);

  // Размер берём с самого контейнера через ResizeObserver, а не из
  // window.innerWidth: последний не обновляется при части изменений
  // (полноэкранный режим, зум, изменение метрик), и слайд уезжает
  // за границы окна прямо в трансляции.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Курсор прячется в покое: он попадает в трансляцию и отвлекает.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 2500);
    };
    wake();
    window.addEventListener('pointermove', wake);
    return () => {
      window.removeEventListener('pointermove', wake);
      clearTimeout(t);
    };
  }, []);

  // Хоткеи работают в обоих окнах одинаково; навигацию и команды
  // исполняет Control — здесь только пересылка (§13).
  useEffect(() => {
    return attachHotkeys((c: Command) => {
      if (c === 'next') bus.current.send({ type: 'nav', payload: { delta: 1 } });
      else if (c === 'prev') bus.current.send({ type: 'nav', payload: { delta: -1 } });
      else if (c === 'first') bus.current.send({ type: 'nav', payload: { to: 0 } });
      else if (c === 'last') bus.current.send({ type: 'nav', payload: { to: 1e9 } });
      else if (c === 'fullscreen') void toggleFullscreen();
      else bus.current.send({ type: 'cmd', payload: { name: c } });
    });
  }, []);

  const openLocal = async (file: File) => {
    const d = await openDeck(file);
    setDeck(d);
    setRenderer(new PageRenderer(d));
  };

  const bandHeight = state.captions.visible ? (size.h * state.captions.bandHeight) / 100 : 0;
  // reserve: слайд вписывается в остаток над полосой. overlay: полоса лежит
  // поверх, слайд занимает всё окно (§6).
  const areaH = state.captions.layout === 'reserve' ? size.h - bandHeight : size.h;
  const aspect = deck?.aspect ?? 16 / 9;

  const addShape = (s: Omit<Shape, 'id'>) =>
    bus.current.send({ type: 'shape:add', payload: { slideIndex: state.slideIndex, shape: { ...s, id: uid('s') } } });

  return (
    <main ref={rootRef} className={`relative h-dvh w-dvw overflow-hidden bg-black ${idle ? 'idle-cursor' : ''}`}>
      {renderer && deck ? (
        <div className="absolute inset-0" style={{ height: areaH }}>
          <SlideCanvas
            renderer={renderer}
            index={Math.min(state.slideIndex, deck.pageCount - 1)}
            aspect={aspect}
            areaW={size.w}
            areaH={areaH}
            onRect={setRect}
          />
          <AnnotationLayer
            shapes={state.shapes}
            rect={rect}
            interactive
            kind={state.shapeKind}
            color={state.shapeColor}
            onAdd={addShape}
            onRemove={(id) => bus.current.send({ type: 'shape:remove', payload: { slideIndex: state.slideIndex, id } })}
            onUndo={() => bus.current.send({ type: 'shape:undo', payload: { slideIndex: state.slideIndex } })}
          />
        </div>
      ) : (
        <DropDeck onFile={openLocal} waiting={state.slideCount > 0} />
      )}

      <CaptionBand
        line={state.captions.visible ? state.captionLine : null}
        settings={state.captions}
        height={(size.h * state.captions.bandHeight) / 100}
      />

      <StatusDot status={state.status} />
    </main>
  );
}

/** Мягкий индикатор: маленькая точка, никаких технических надписей
 *  в расшаренной области (§9). */
function StatusDot({ status }: { status: PresentationState['status'] }) {
  const color =
    status === 'listening'
      ? 'var(--color-ok)'
      : status === 'reconnecting' || status === 'connecting'
        ? 'var(--color-warn)'
        : status === 'error'
          ? 'var(--color-err)'
          : 'rgba(255,255,255,0.22)';
  return (
    <div
      className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full transition-colors"
      style={{ background: color, boxShadow: '0 0 8px rgba(0,0,0,0.6)' }}
      aria-hidden
    />
  );
}

/** Колода грузится в каждом окне отдельно: файл не гоняется через
 *  BroadcastChannel, а Control и Presentation читают один и тот же PDF. */
function DropDeck({ onFile, waiting }: { onFile: (f: File) => void; waiting: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f?.name.toLowerCase().endsWith('.pdf')) void onFile(f);
      }}
    >
      <div
        className={`rounded-xl border-2 border-dashed px-10 py-8 text-center text-sm transition-colors ${
          over ? 'border-accent text-fg' : 'border-white/15 text-white/45'
        }`}
      >
        <p className="text-base font-semibold text-white/80">Presentation window</p>
        <p className="mt-2">Drop the same PDF here.</p>
        {waiting ? <p className="mt-1 text-white/35">Connected to Control.</p> : null}
      </div>
    </div>
  );
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    /* пользователь отказал — не наша забота */
  }
}
