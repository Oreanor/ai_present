'use client';

import { PALETTE, SHAPE_LABELS, SHAPE_ORDER } from '@/lib/shapes';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/ui-prefs';

/**
 * Выбор фигуры и цвета для разметки.
 *
 * Лежит поверх слайда и проявляется при наведении: во время доклада
 * рисуют изредка, а место панель занимала бы постоянно. Клавиатурой
 * то же самое: Tab меняет фигуру, Q стирает слайд.
 */
export function AnnotationTools() {
  const { shapeKind, shapeColor, setShapeKind, setShapeColor, clearShapes, undoShape } = useStore();
  const t = useT();

  return (
    <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded-lg bg-black/70 p-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 hover:opacity-100 group-hover/stage:opacity-70">
      {SHAPE_ORDER.map((k) => (
        <button
          key={k}
          onClick={() => setShapeKind(k)}
          title={`${SHAPE_LABELS[k]} (Tab)`}
          className={`rounded px-2 py-1 text-[11px] text-white/80 ${shapeKind === k ? 'bg-white/25 text-white' : 'hover:bg-white/10'}`}
        >
          {k === 'rect' ? '▭' : k === 'ellipse' ? '◯' : '➜'}
        </button>
      ))}

      <span className="mx-0.5 h-4 w-px bg-white/20" />

      {PALETTE.map((c) => (
        <button
          key={c.name}
          onClick={() => setShapeColor(c.value)}
          title={c.name}
          className={`h-4 w-4 rounded-full border ${shapeColor === c.value ? 'border-white' : 'border-transparent'}`}
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
