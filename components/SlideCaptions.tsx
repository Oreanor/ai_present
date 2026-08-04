'use client';

import { useShallow } from 'zustand/react/shallow';
import { CaptionBand } from './CaptionBand';
import type { Rect } from '@/lib/geometry';
import { useStore } from '@/lib/store';

/**
 * Субтитры поверх самого слайда — для полноэкранного показа, где нижней
 * полосы уже нет: на весь экран растянут только слайд.
 *
 * Ведут себя как субтитры, а не как бегущая строка: карточка держится
 * несколько секунд и гаснет (вся логика — в CaptionBand). Висеть над
 * слайдом весь доклад им незачем, связный текст копится в ленте.
 *
 * Своя подписка на стор: строка меняется по нескольку раз в минуту, и
 * тянуть из-за неё перерисовку всей страницы не нужно.
 */
export function SlideCaptions({ rect }: { rect: Rect }) {
  const { captionLine, captions } = useStore(
    useShallow((s) => ({ captionLine: s.captionLine, captions: s.captions })),
  );

  if (rect.w < 2) return null;

  return (
    <div
      className="pointer-events-none absolute overflow-hidden"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <CaptionBand line={captionLine} settings={captions} height={(rect.h * captions.bandHeight) / 100} />
    </div>
  );
}
