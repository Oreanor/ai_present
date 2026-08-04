'use client';

import { APOLOGY } from '@/lib/easter-egg';
import type { Rect } from '@/lib/geometry';
import type { Lang } from '@/lib/types';

/**
 * Пасхалка: на крепкое слово слайд на пару секунд закрывается извинениями
 * на языке того, кто выразился.
 *
 * Закрывает ровно площадь слайда, а не всю сцену: шутка в том, что доклад
 * стыдливо отвернулся, а не в том, что приложение сломалось.
 */
export function ApologyOverlay({ rect, lang }: { rect: Rect; lang: Lang }) {
  return (
    <div
      className="pointer-events-none absolute z-20 flex items-center justify-center bg-ink px-10 text-center"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <p className="text-[42px] font-semibold leading-tight text-dim" style={{ textWrap: 'balance' }}>
        {APOLOGY[lang]}
      </p>
    </div>
  );
}
