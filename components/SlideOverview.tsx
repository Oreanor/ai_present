'use client';

import { useEffect, useState } from 'react';
import type { PageRenderer } from '@/lib/pdf';
import { RENDER } from '@/lib/constants';
import { useStore } from '@/lib/store';

/**
 * Вся колода миниатюрами — окинуть её взглядом и прыгнуть куда надо.
 *
 * Вызывается голосом («давай общий») и закрывается выбором слайда или
 * Escape. Кнопки в панели у него нет намеренно: обзор нужен в тот момент,
 * когда вопрос из зала отсылает к слайду, номер которого никто не помнит,
 * а лезть в панель в этот момент некогда.
 *
 * Миниатюры рисуются по одной и мимо кэша страниц: тридцать миниатюр,
 * положенных в кэш, вытеснили бы оттуда полноразмерный слайд.
 */
export function SlideOverview({ renderer, count }: { renderer: PageRenderer; count: number }) {
  const { slideIndex, goto, setOverview } = useStore();
  const [thumbs, setThumbs] = useState<(string | null)[]>(() => new Array(count).fill(null));

  useEffect(() => {
    let cancelled = false;
    setThumbs(new Array(count).fill(null));
    void (async () => {
      for (let i = 0; i < count; i++) {
        if (cancelled) return;
        try {
          const url = await renderer.thumbnailOf(i, RENDER.OVERVIEW_THUMB_PX);
          if (cancelled) return;
          setThumbs((prev) => {
            const next = [...prev];
            next[i] = url;
            return next;
          });
        } catch {
          // Одна не отрисовалась — остальные всё равно нужны.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [renderer, count]);

  // Escape закрывает: это единственный способ уйти, не выбирая слайд.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOverview(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOverview]);

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-black/85 p-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        {thumbs.map((src, i) => (
          <button
            key={i}
            onClick={() => {
              goto(i);
              setOverview(false);
            }}
            className={`relative overflow-hidden rounded border transition-colors ${
              i === slideIndex ? 'border-accent' : 'border-white/15 hover:border-white/50'
            }`}
          >
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" className="block w-full" />
            ) : (
              <div className="aspect-video w-full bg-white/5" />
            )}
            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 text-[11px] font-mono text-white/80">
              {i + 1}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
