'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnnotationLayer } from '@/components/AnnotationLayer';
import { SIDE_MIN_FRACTION, sideRoom } from '@/components/CaptionColumn';
import { LogView } from '@/components/LogView';
import { QualityPanel } from '@/components/QualityPanel';
import { SlideCanvas, type SlideRect } from '@/components/SlideCanvas';
import { SetupWizard } from '@/components/SetupWizard';
import { getBus, type BusMessage } from '@/lib/bus';
import { exportAll, download, flaggedMarkdown, fullMarkdown } from '@/lib/export';
import { extractTerms } from '@/lib/glossary';
import { attachHotkeys, HOTKEY_HELP, type Command } from '@/lib/hotkeys';
import { openDeck, PageRenderer, type Deck } from '@/lib/pdf';
import { needsApiKey } from '@/lib/profile';
import { PALETTE, SHAPE_LABELS } from '@/lib/shapes';
import { createProvider, planChannels, type ProviderId } from '@/lib/speech/registry';
import type { SpeechProvider } from '@/lib/speech/types';
import { quota } from '@/lib/speech/gemini-provider';
import { fingerprint, loadProfile } from '@/lib/storage';
import { hydrateStore, useStore } from '@/lib/store';
import type { Mode, Speaker } from '@/lib/types';
import { arrange, openPresentation } from '@/lib/windows';

export default function ControlPage() {
  const s = useStore();
  const [ready, setReady] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [renderer, setRenderer] = useState<PageRenderer | null>(null);
  const [rect, setRect] = useState<SlideRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [previewSize, setPreviewSize] = useState({ w: 0, h: 0 });
  const [query, setQuery] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [used, setUsed] = useState(0);
  /** Демо на MockProvider: первый клик — ведущий, второй добавляет зал. */
  const [demo, setDemo] = useState(false);

  const bus = useRef(getBus());
  const presentWin = useRef<Window | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const providers = useRef<Partial<Record<Speaker, SpeechProvider>>>({});
  const terms = useRef<string[]>([]);

  // Гидратация из localStorage только на клиенте: в initial state нельзя,
  // сервер и клиент разошлись бы разметкой.
  useEffect(() => {
    hydrateStore();
    setWizard(loadProfile() === null);
    void useStore.getState().restoreLog();
    setReady(true);
    const off = quota.subscribe(setUsed);
    return () => {
      off();
    };
  }, []);

  // Снимок состояния Presentation. Отправляется на каждое изменение и
  // в ответ на hello — без этого перезагрузка окна теряет состояние (§1).
  const snapshot = useStore((st) => st.snapshot);
  useEffect(() => {
    if (!ready) return;
    bus.current.send({ type: 'state', payload: snapshot() });
  }, [ready, snapshot, s.slideIndex, s.captions, s.annotations, s.captionLine, s.shapeKind, s.shapeColor, s.presenterStatus, s.audienceStatus, s.mode]);

  useEffect(() => {
    return bus.current.on((m: BusMessage) => {
      const st = useStore.getState();
      switch (m.type) {
        case 'hello':
          bus.current.send({ type: 'state', payload: st.snapshot() });
          break;
        case 'nav':
          if (m.payload.delta) st.move(m.payload.delta);
          else if (m.payload.to !== undefined) st.goto(m.payload.to);
          break;
        case 'shape:add':
          st.addShape(m.payload.shape);
          break;
        case 'shape:remove':
          st.removeShape(m.payload.id);
          break;
        case 'shape:undo':
          st.undoShape();
          break;
        case 'cmd':
          runCommand(m.payload.name as Command);
          break;
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPreviewSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setPreviewSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [deck]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  // --- команды ------------------------------------------------------------

  const runCommand = useCallback((c: Command) => {
    const st = useStore.getState();
    switch (c) {
      case 'next':
        st.move(1);
        break;
      case 'prev':
        st.move(-1);
        break;
      case 'first':
        st.goto(0);
        break;
      case 'last':
        st.goto(st.slideCount - 1);
        break;
      case 'mode':
        st.cycleMode();
        break;
      case 'captions':
        st.setCaptions({ visible: !st.captions.visible });
        break;
      case 'lang': {
        const next = st.cyclePresenterLang();
        if (next) {
          providers.current.presenter?.setLanguage?.(next);
          st.toast_(`Microphone: ${next.toUpperCase()}`);
        } else st.toast_('Language is auto-detected — nothing to pin.', 'warn');
        break;
      }
      case 'gemini':
        void swapPresenterProvider();
        break;
      case 'flag':
        st.flagLast();
        break;
      case 'export':
        exportAll(st.entries, st.profile);
        break;
      case 'fullscreen':
        presentWin.current?.focus();
        break;
      case 'shapeKind':
        st.cycleShapeKind();
        break;
      case 'clearSlide':
        st.clearShapes(false);
        break;
      case 'clearAll':
        if (confirm('Erase annotations on every slide?')) st.clearShapes(true);
        break;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => attachHotkeys(runCommand), [runCommand]);

  // --- колода -------------------------------------------------------------

  const openFile = async (file: File) => {
    const st = useStore.getState();
    try {
      const d = await openDeck(file);
      const id = await fingerprint(file);
      const r = new PageRenderer(d);
      setDeck(d);
      setRenderer(r);
      st.setDeck(id, d.pageCount, d.aspect);
      for (const w of d.warnings) st.toast_(w.text, 'warn');

      // Узкая колода оставляет пустые поля внутри расшаренного окна.
      // Предлагаем занять их — сам пользователь об этом не догадается.
      const room = sideRoom(16 / 9, d.aspect);
      if (room >= SIDE_MIN_FRACTION && st.captions.layout !== 'side') {
        st.toast_(
          `This deck leaves ${Math.round(room * 100)}% of the shared window empty. ` +
            'The "side" caption layout puts a rolling transcript there.',
        );
      }

      // Словарь терминов из текста слайдов (§6б).
      const texts: string[] = [];
      for (let i = 0; i < d.pageCount; i++) texts.push(await r.text(i));
      terms.current = extractTerms(texts);
    } catch (e) {
      st.toast_(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  // --- распознавание ------------------------------------------------------

  const startChannel = async (speaker: Speaker, id: ProviderId) => {
    const st = useStore.getState();
    await providers.current[speaker]?.stop();

    const p = createProvider(id);
    providers.current[speaker] = p;
    const isPresenter = speaker === 'presenter';
    const mode = isPresenter ? st.profile.presenterMode : st.profile.audienceMode;
    const langs = isPresenter ? st.profile.presenterLangs : st.profile.audienceLangs;

    let source: { kind: 'mic' } | { kind: 'stream'; stream: MediaStream } = { kind: 'mic' };
    // Мок звука не слушает вовсе — ни микрофона, ни захвата экрана.
    if (!isPresenter && id !== 'mock') {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        stream.getVideoTracks().forEach((t) => t.stop()); // видео не нужно
        if (!stream.getAudioTracks().length) {
          st.toast_('No system audio track — pick "Entire screen" and tick "Also share system audio".', 'error');
          return;
        }
        source = { kind: 'stream', stream };
      } catch {
        st.toast_('Screen capture cancelled.', 'warn');
        return;
      }
    }

    await p.start({
      source,
      sourceLang: mode.kind === 'pin' ? [mode.current] : langs,
      targetLangs: st.profile.transcriptLangs,
      phrases: terms.current,
      onPartial: (u) => useStore.getState().ingest(u, speaker, false),
      onFinal: (u) => useStore.getState().ingest(u, speaker, true),
      onTranslation: (uid_, lang, text) => useStore.getState().applyTranslation(uid_, lang, text),
      onError: (e) => useStore.getState().toast_(e.message, 'error'),
      onStatus: (status) => useStore.getState().setStatus(speaker, status),
    });
    setRunning(true);
  };

  const stopChannel = async (speaker: Speaker) => {
    await providers.current[speaker]?.stop();
    delete providers.current[speaker];
    useStore.getState().setStatus(speaker, 'idle');
  };

  /** Клавиша G — аварийный переход микрофона на Gemini и обратно (§11). */
  const swapPresenterProvider = async () => {
    const st = useStore.getState();
    const current = providers.current.presenter?.id as ProviderId | undefined;
    if (!current) {
      st.toast_('Microphone is not running.', 'warn');
      return;
    }
    const next: ProviderId = current === 'free' ? 'gemini' : 'free';
    if (next === 'gemini' && !needsApiKey({ ...st.profile, presenterMode: { kind: 'auto' } })) {
      /* профиль допускает — ключ проверит сам провайдер */
    }
    await startChannel('presenter', next);
    st.toast_(`Microphone provider: ${next}`);
  };

  const applyMode = async (m: Mode) => {
    const st = useStore.getState();
    st.setMode(m);
    const plan = planChannels(st.profile);
    if (m === 'presenting' || m === 'both') await startChannel('presenter', plan.presenter);
    else await stopChannel('presenter');
    if (m === 'qa' || m === 'both') await startChannel('audience', plan.audience);
    else await stopChannel('audience');
  };

  useEffect(() => {
    return () => {
      void providers.current.presenter?.stop();
      void providers.current.audience?.stop();
      renderer?.destroy();
    };
  }, [renderer]);

  if (!ready) return <div className="p-6 text-sm text-dim">Loading…</div>;
  if (wizard)
    return (
      <SetupWizard
        onDone={(p) => {
          useStore.getState().setProfile(p);
          setWizard(false);
        }}
      />
    );

  const plan = planChannels(s.profile);
  const shapes = s.annotations[s.slideIndex] ?? [];

  return (
    <main className="flex h-dvh flex-col overflow-hidden text-sm">
      {/* Верхняя панель */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <button
          onClick={() => {
            presentWin.current = openPresentation(deck?.aspect);
          }}
          className="rounded bg-accent px-2.5 py-1 text-xs font-semibold text-black"
        >
          Open presentation
        </button>
        <button
          onClick={() => arrange(presentWin.current, deck?.aspect)}
          className="rounded border border-line px-2.5 py-1 text-xs"
          title="Size both windows for a single monitor"
        >
          Arrange windows
        </button>
        <button
          onClick={() => void startChannel(demo ? 'audience' : 'presenter', 'mock').then(() => setDemo(true))}
          className="rounded border border-line px-2.5 py-1 text-xs"
          title="Play a recorded script — no microphone, no network, no quota"
        >
          Demo
        </button>

        <div className="ml-auto flex items-center gap-1">
          {(['presenting', 'qa', 'both'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => void applyMode(m)}
              disabled={m === 'both' && !plan.bothAvailable}
              className={`rounded px-2 py-1 text-xs capitalize ${
                s.mode === m ? 'bg-accent font-semibold text-black' : 'border border-line'
              } disabled:opacity-40`}
              title={m === 'both' && !plan.bothAvailable ? plan.warnings.join(' ') : undefined}
            >
              {m}
            </button>
          ))}
        </div>

        <Dot label="mic" status={s.presenterStatus} />
        <Dot label="room" status={s.audienceStatus} />
        <span className="font-mono text-xs text-dim">{fmt(elapsed)}</span>
        {quotaVisible(plan) ? (
          <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-dim">
            Gemini {used}
          </span>
        ) : null}
      </header>

      {s.toast ? (
        <div
          className={`shrink-0 px-3 py-1.5 text-xs ${
            s.toast.kind === 'error'
              ? 'bg-err/20 text-err'
              : s.toast.kind === 'warn'
                ? 'bg-warn/15 text-warn'
                : 'bg-white/5 text-dim'
          }`}
        >
          {s.toast.text}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        {/* Превью слайда — только для просмотра, рисовать отсюда нельзя (§6а) */}
        <div ref={previewRef} className="relative h-[34%] shrink-0 border-b border-line bg-black">
          {renderer && deck ? (
            <>
              <SlideCanvas
                renderer={renderer}
                index={s.slideIndex}
                aspect={deck.aspect}
                areaW={previewSize.w}
                areaH={previewSize.h}
                onRect={setRect}
              />
              <AnnotationLayer shapes={shapes} rect={rect} interactive={false} />
            </>
          ) : (
            <DeckDrop onFile={openFile} />
          )}
        </div>

        {/* Навигация и разметка */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5 text-xs">
          <button onClick={() => s.move(-1)} className="rounded border border-line px-2 py-0.5">
            ←
          </button>
          <span className="font-mono text-dim">
            {s.slideCount ? s.slideIndex + 1 : 0} / {s.slideCount}
          </span>
          <button onClick={() => s.move(1)} className="rounded border border-line px-2 py-0.5">
            →
          </button>

          <span className="mx-2 h-4 w-px bg-line" />

          <button
            onClick={() => s.cycleShapeKind()}
            className="rounded border border-line px-2 py-0.5"
            title="Tab"
          >
            {SHAPE_LABELS[s.shapeKind]}
          </button>
          {PALETTE.map((c) => (
            <button
              key={c.name}
              onClick={() => s.setShapeColor(c.value)}
              className={`h-5 w-5 rounded border ${s.shapeColor === c.value ? 'border-white' : 'border-transparent'}`}
              style={{ background: c.value.replace(/[\d.]+\)$/, '0.9)') }}
              title={c.name}
            />
          ))}
          <button onClick={() => s.clearShapes(false)} className="rounded border border-line px-2 py-0.5">
            Clear (Q)
          </button>

          <span className="mx-2 h-4 w-px bg-line" />

          <button
            onClick={() => s.setCaptions({ visible: !s.captions.visible })}
            className={`rounded px-2 py-0.5 ${s.captions.visible ? 'border border-line' : 'bg-err text-black'}`}
          >
            {s.captions.visible ? 'Captions on (H)' : 'Captions hidden'}
          </button>
          {(['reserve', 'overlay', 'side'] as const).map((l) => {
            // Колонка осмысленна только если слайд уже окна: 4:3 внутри 16:9
            // оставляет четверть ширины, 16:9 внутри 16:9 — ничего.
            const roomy = sideRoom(16 / 9, deck?.aspect ?? 16 / 9) >= SIDE_MIN_FRACTION;
            const disabled = l === 'side' && !roomy;
            return (
              <button
                key={l}
                onClick={() => s.setCaptions({ layout: l })}
                disabled={disabled}
                title={
                  disabled
                    ? 'No room for a side column — the slide already fills the window width.'
                    : l === 'side'
                      ? 'Use the empty space beside a 4:3 slide for a rolling transcript in the audience language.'
                      : undefined
                }
                className={`rounded px-2 py-0.5 ${
                  s.captions.layout === l ? 'bg-accent font-semibold text-black' : 'border border-line'
                } disabled:opacity-35`}
              >
                {l}
              </button>
            );
          })}
        </div>

        <QualityPanel
          entries={s.entries}
          profile={s.profile}
          partial={s.partial}
          onCycleLang={() => runCommand('lang')}
        />

        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the log…"
            className="min-w-0 flex-1 rounded border border-line bg-ink px-2 py-1 text-xs outline-none focus:border-accent"
          />
          <button onClick={() => setRunning((v) => !v)} className="rounded border border-line px-2 py-1 text-xs">
            {running ? 'Pause timer' : 'Start timer'}
          </button>
        </div>

        <LogView
          entries={s.entries}
          profile={s.profile}
          query={query}
          onToggleFlag={s.toggleFlag}
          onEdit={s.editEntry}
        />

        <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-line px-3 py-1.5 text-xs">
          <button onClick={() => exportAll(s.entries, s.profile)} className="rounded bg-accent px-2 py-1 font-semibold text-black">
            Export transcripts (E)
          </button>
          <button
            onClick={() => download('log-full.md', fullMarkdown(s.entries, s.profile))}
            className="rounded border border-line px-2 py-1"
          >
            Full log
          </button>
          <button
            onClick={() => download('follow-up.md', flaggedMarkdown(s.entries, s.profile.transcriptLangs[0]))}
            className="rounded border border-line px-2 py-1"
          >
            Flagged
          </button>
          <button onClick={() => setWizard(true)} className="ml-auto rounded border border-line px-2 py-1">
            Setup
          </button>
          <details className="relative">
            <summary className="cursor-pointer rounded border border-line px-2 py-1">Keys</summary>
            <div className="absolute bottom-8 right-0 z-10 w-64 rounded-lg border border-line bg-panel p-2 shadow-xl">
              {HOTKEY_HELP.map((h) => (
                <div key={h.keys} className="flex justify-between gap-2 py-0.5 text-[11px]">
                  <span className="font-mono text-accent">{h.keys}</span>
                  <span className="text-dim">{h.label}</span>
                </div>
              ))}
            </div>
          </details>
        </footer>
      </div>
    </main>
  );
}

function quotaVisible(plan: ReturnType<typeof planChannels>): boolean {
  return plan.presenter === 'gemini' || plan.audience === 'gemini';
}

function Dot({ label, status }: { label: string; status: string }) {
  const color =
    status === 'listening'
      ? 'var(--color-ok)'
      : status === 'connecting' || status === 'reconnecting'
        ? 'var(--color-warn)'
        : status === 'error'
          ? 'var(--color-err)'
          : 'var(--color-line)';
  return (
    <span className="flex items-center gap-1 text-[10px] uppercase text-dim" title={status}>
      <i className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${String(m).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function DeckDrop({ onFile }: { onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`absolute inset-0 flex cursor-pointer items-center justify-center border-2 border-dashed text-xs transition-colors ${
        over ? 'border-accent text-fg' : 'border-line text-dim'
      }`}
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
      <input
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      <span className="text-center">
        Drop a landscape PDF here
        <br />
        <span className="opacity-60">or click to choose</span>
      </span>
    </label>
  );
}
