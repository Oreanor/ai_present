'use client';

import { useEffect, useRef, useState } from 'react';
import type { PageRenderer } from '@/lib/pdf';
import { RENDER } from '@/lib/constants';
import { fitContain, type Rect } from '@/lib/geometry';

// Прямоугольник слайда описан в geometry — здесь только реэкспорт для
// компонентов, которые уже на него ссылаются.
export type SlideRect = Rect;

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
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        host.replaceChildren(canvas);
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
