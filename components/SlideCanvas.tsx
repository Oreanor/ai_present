'use client';

import { useEffect, useRef, useState } from 'react';
import type { PageRenderer } from '@/lib/pdf';
import { fitContain } from '@/lib/pdf';

export type SlideRect = { x: number; y: number; w: number; h: number };

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

  useEffect(() => {
    if (!renderer || rect.w < 2) return;
    let cancelled = false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    renderer
      .render(index, rect.w, dpr)
      .then((canvas) => {
        if (cancelled) return;
        const host = hostRef.current;
        if (!host) return;
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        host.replaceChildren(canvas);
        setError(null);
        renderer.prefetch(index, rect.w, dpr);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [renderer, index, rect.w, rect.h]);

  return (
    <div
      ref={hostRef}
      className="absolute overflow-hidden bg-white"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      {error ? <div className="p-4 text-sm text-err">{error}</div> : null}
    </div>
  );
}
