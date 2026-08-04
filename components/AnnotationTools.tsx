'use client';

import { PALETTE, SHAPES } from '@/lib/shapes';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/ui-prefs';

/**
 * Выбор фигуры и цвета для разметки.
 *
 * Прибита к верху слайда по центру и проявляется, только когда курсор
 * подняли к самому верху. От движения мышью где угодно по слайду она
 * всплывала постоянно — в том числе прямо во время рисования.
 *
 * Верх по центру — потому что у краёв слайда во всю высоту лежат зоны
 * перелистывания, и панель там воровала бы их клики.
 *
 * Клавиатурой то же самое: Tab меняет фигуру, Q стирает слайд.
 */
export function AnnotationTools({ visible }: { visible: boolean }) {
  const { shapeKind, shapeColor, setShapeKind, setShapeColor, clearShapes, undoShape } = useStore();
  const t = useT();

  return (
    <div
      className={`absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-black/70 p-1 transition-opacity duration-150 ${
        visible ? 'opacity-90' : 'pointer-events-none opacity-0'
      }`}
    >
      {SHAPES.map((s) => (
        <button
          key={s.kind}
          onClick={() => setShapeKind(s.kind)}
          title={`${t(s.label)} (Tab)`}
          className={`rounded px-2 py-1 text-[11px] text-white/80 ${shapeKind === s.kind ? 'bg-white/25 text-white' : 'hover:bg-white/10'}`}
        >
          {s.glyph}
        </button>
      ))}

      <span className="mx-0.5 h-4 w-px bg-white/20" />

      {PALETTE.map((c) => (
        <button
          key={c.name}
          onClick={() => setShapeColor(c.value)}
          title={c.name}
          className={`h-4 w-4 rounded-full border-2 ${shapeColor === c.value ? 'border-white' : 'border-transparent'}`}
          style={{ background: c.value.replace(/[\d.]+\)$/, '0.9)') }}
        />
      ))}

      <span className="mx-0.5 h-4 w-px bg-white/20" />

      <button
        onClick={undoShape}
        title={t('undoShape')}
        className="rounded px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
      >
        ↶
      </button>
      <button
        onClick={() => clearShapes(false)}
        title={`${t('clearSlideShapes')} (Q)`}
        className="rounded px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
      >
        ✕
      </button>
    </div>
  );
}
