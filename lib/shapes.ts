import { ANNOTATION } from './constants';
import type { StringKey } from './ui-prefs';
import type { Shape, ShapeKind } from './types';

// Палитра и типы фигур. Геометрия — в lib/geometry.ts: попадание по фигуре
// и путь стрелки это те же расчёты, что вписывание слайда, и жить им лучше
// вместе.

export const PALETTE = [
  { name: 'yellow', value: 'rgb(250 204 21 / 0.35)' },
  { name: 'green', value: 'rgb(52 211 153 / 0.35)' },
  { name: 'blue', value: 'rgb(96 165 250 / 0.35)' },
  { name: 'pink', value: 'rgb(244 114 182 / 0.35)' },
  { name: 'orange', value: 'rgb(251 146 60 / 0.35)' },
] as const;

/**
 * Фигуры вместе со значком и ключом подписи. Значок лежит здесь, а не в
 * разметке кнопки: подставлять его тернарником по виду фигуры значит
 * править разметку каждый раз, когда фигур становится больше.
 */
export const SHAPES: { kind: ShapeKind; glyph: string; label: StringKey }[] = [
  { kind: 'rect', glyph: '▭', label: 'shapeRect' },
  { kind: 'ellipse', glyph: '◯', label: 'shapeEllipse' },
  { kind: 'arrow', glyph: '➜', label: 'shapeArrow' },
];

export function nextShapeKind(k: ShapeKind): ShapeKind {
  const i = SHAPES.findIndex((s) => s.kind === k);
  return SHAPES[(i + 1) % SHAPES.length].kind;
}

/** Стрелка без площади: пастель на ней не читается, делаем плотнее. */
export function strokeFor(fill: string): string {
  return fill.replace(/[\d.]+\)$/, '0.95)');
}

export function isDegenerate(s: Shape, areaW: number, areaH: number): boolean {
  return (
    Math.abs(s.x2 - s.x1) * areaW < ANNOTATION.DRAG_THRESHOLD_PX &&
    Math.abs(s.y2 - s.y1) * areaH < ANNOTATION.DRAG_THRESHOLD_PX
  );
}
