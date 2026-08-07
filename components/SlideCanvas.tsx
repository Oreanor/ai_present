'use client';

import { useEffect, useRef, useState } from 'react';
import type { PageRenderer } from '@/lib/pdf';
import { RENDER } from '@/lib/constants';
import { fitContain, type Rect } from '@/lib/geometry';

// Прямоугольник слайда описан в geometry — здесь только реэкспорт для
// компонентов, которые уже на него ссылаются.
export type SlideRect = Rect;

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Снять следы прошлого ухода: кэш pdf.js отдаёт тот же элемент снова. */
function reveal(c: HTMLCanvasElement): void {
  delete c.dataset.leaving;
  c.style.transition = '';
  c.style.opacity = '';
}

/**
 * Подмена холста с кроссфейдом. Новый кадр кладётся ПОД старый и сразу
 * непрозрачным, гаснет старый — а не наоборот. Порядок здесь не вкусовой:
 * перекрытое окно Chrome может не проиграть переход вовсе, и тогда при
 * проявлении нового зал получил бы в трансляции белый прямоугольник (§1).
 * В таком порядке несыгравшая анимация стоит лишь мгновения старого кадра.
 */
function swapIn(host: HTMLElement, next: HTMLCanvasElement, fade: boolean): void {
  const prev = host.querySelector<HTMLCanvasElement>('canvas:not([data-leaving])');

  // Уходящих холстов не ждём. При быстрой перелистке они копились бы, а
  // кэш pdf.js отдаёт на страницу ОДИН И ТОТ ЖЕ элемент — вернувшись
  // назад, мы получили бы именно тот узел, который сейчас гаснет.
  for (const c of host.querySelectorAll<HTMLCanvasElement>('canvas[data-leaving]')) {
    if (c !== next) c.remove();
  }
  reveal(next);

  if (!prev || prev === next || !fade || reducedMotion()) {
    if (prev !== next) prev?.remove();
    if (next.parentNode !== host) host.prepend(next);
    return;
  }

  host.prepend(next); // раньше по порядку — значит, ниже по отрисовке
  prev.dataset.leaving = '';
  prev.style.transition = `opacity ${RENDER.CROSSFADE_MS}ms linear`;
  prev.style.opacity = '0';

  // transitionend не придёт, если переход не начался (окно перекрыто,
  // вкладка скрыта). Без таймера старый кадр остался бы висеть поверх
  // нового навсегда. Метку снимает reveal(), так что вернувшийся из кэша
  // холст этот таймер уже не заденет.
  const drop = () => {
    if (prev.dataset.leaving !== undefined) prev.remove();
  };
  prev.addEventListener('transitionend', drop, { once: true });
  setTimeout(drop, RENDER.CROSSFADE_MS + 60);
}

/**
 * Рендер слайда. Вписывание contain по ОБЕИМ осям (§6): подгонка только
 * по ширине увела бы низ кадра за границу окна вместе с субтитрами.
 *
 * Рендер идёт синхронно по смене пропсов, без rAF-петли: перекрытое окно
 * Chrome перестаёт обслуживать rAF, а Teams продолжает транслировать
 * зрителям застывший кадр (§1).
 */
export function SlideCanvas({
  renderer,
  index,
  aspect,
  areaW,
  areaH,
  onRect,
}: {
  renderer: PageRenderer | null;
  index: number;
  aspect: number;
  areaW: number;
  areaH: number;
  onRect?: (r: SlideRect) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  /** Что сейчас на экране. Смена ширины при тяге за край окна тоже
   *  перерисовывает холст, и без этого каждый шаг в 128 пикселей давал бы
   *  кроссфейд слайда с самим собой. */
  const shownIndex = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rect = fitContain(areaW, areaH, aspect);

  useEffect(() => {
    onRect?.(rect);
  }, [rect.x, rect.y, rect.w, rect.h, onRect]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ширина отрисовки округляется вверх до шага: иначе перетаскивание края
  // окна заставляет pdf.js перерисовывать страницу на каждый пиксель.
  const drawW = Math.ceil(rect.w / RENDER.WIDTH_STEP) * RENDER.WIDTH_STEP;

  useEffect(() => {
    if (!renderer || drawW < 2) return;
    let cancelled = false;
    const dpr = Math.min(window.devicePixelRatio || 1, RENDER.MAX_DPR);

    renderer
      .render(index, drawW, dpr)
      .then((canvas) => {
        if (cancelled) return;
        const host = hostRef.current;
        if (!host) return;
        const changed = shownIndex.current !== null && shownIndex.current !== index;
        shownIndex.current = index;
        swapIn(host, canvas, changed);
        setError(null);
        renderer.prefetch(index, drawW, dpr);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [renderer, index, drawW]);

  return (
    <div
      ref={hostRef}
      className="slide-frame absolute overflow-hidden bg-white"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      {error ? <div className="p-4 text-sm text-err">{error}</div> : null}
    </div>
  );
}
