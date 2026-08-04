'use client';

import { PALETTE, SHAPES } from '@/lib/shapes';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/ui-prefs';

/**
 * Выбор фигуры и цвета для разметки — одной строкой под перепиской.
 *
 * Поверх слайда панель жить не может: у краёв слайда лежат зоны
 * перелистывания во всю высоту, и панель ловила их клики. Сдвигать её
 * вглубь слайда значит закрывать сам слайд. В правой колонке места
 * ровно на одну строку, и там она никому не мешает.
 *
 * Клавиатурой то же самое: Tab меняет фигуру, Q стирает слайд.
 */
export function AnnotationTools() {
  const { shapeKind, shapeColor, setShapeKind, setShapeColor, clearShapes, undoShape } = useStore();
  const t = useT();

  return (
    <div className="flex shrink-0 items-center gap-1 border-t border-line px-2 py-1.5">
      {SHAPES.map((s) => (
        <button
          key={s.kind}
          onClick={() => setShapeKind(s.kind)}
          title={`${t(s.label)} (Tab)`}
          className={`btn btn-sm ${shapeKind === s.kind ? 'btn-on' : ''}`}
        >
          {s.glyph}
        </button>
      ))}

      <span className="mx-1 h-4 w-px bg-line" />

      {PALETTE.map((c) => (
        <button
          key={c.name}
          onClick={() => setShapeColor(c.value)}
          title={c.name}
          className={`h-4 w-4 rounded-full border-2 ${shapeColor === c.value ? 'border-fg' : 'border-transparent'}`}
          style={{ background: c.value.replace(/[\d.]+\)$/, '0.9)') }}
        />
      ))}

      <button onClick={undoShape} title={t('undoShape')} className="btn btn-sm ml-auto">
        ↶
      </button>
      <button onClick={() => clearShapes(false)} title={`${t('clearSlideShapes')} (Q)`} className="btn btn-sm">
        ✕
      </button>
    </div>
  );
}
