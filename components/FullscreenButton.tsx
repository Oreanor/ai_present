'use client';

import type { Rect } from '@/lib/geometry';
import { useT, type StringKey } from '@/lib/ui-prefs';

/**
 * Кнопка полноэкранного показа — в углу САМОГО слайда, а не окна.
 *
 * Раньше она висела в углу сцены с отступом в семьдесят два пикселя: так
 * её отодвигали от зоны перелистывания, и выглядело это как случайно
 * оброненный значок. Теперь угол считается от слайда, отступ от него
 * ровный со всех сторон, а зону перелистывания кнопка перекрывает сама,
 * потому что стоит в разметке после неё.
 *
 * Значок рисованный, а не символ шрифта: у «⛶» размер и вес зависят от
 * того, каким шрифтом его подставит система, и на этой машине он выходил
 * тонкой мелкой чёрточкой.
 */
const ICONS: Record<'on' | 'off', { d: string; label: StringKey }> = {
  off: {
    d: 'M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3',
    label: 'enterFullscreen',
  },
  on: {
    d: 'M3 8h3a2 2 0 0 0 2-2V3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M21 16h-3a2 2 0 0 0-2 2v3',
    label: 'exitFullscreen',
  },
};

export function FullscreenButton({ rect, full, onToggle }: { rect: Rect; full: boolean; onToggle: () => void }) {
  const t = useT();
  const icon = ICONS[full ? 'on' : 'off'];

  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <button
        onClick={onToggle}
        title={t(icon.label)}
        className="pointer-events-auto absolute bottom-3 right-3 flex h-9 w-9 items-center justify-center rounded-lg
                   bg-black/55 text-white/85 opacity-0 ring-1 ring-white/20 backdrop-blur-sm transition
                   hover:bg-black/80 hover:text-white hover:opacity-100 focus:opacity-100 group-hover/stage:opacity-80"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d={icon.d} />
        </svg>
      </button>
    </div>
  );
}
