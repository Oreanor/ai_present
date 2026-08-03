import type { Shape, ShapeKind } from './types';

// Геометрия разметки (§6а). Координаты нормализованы к области слайда (0..1):
// окно меняет размер, Teams масштабирует, переключение reserve/overlay двигает
// слайд — при пиксельных координатах разметка уехала бы с места.

export const PALETTE = [
  { name: 'yellow', value: 'rgba(250, 204, 21, 0.35)' },
  { name: 'green', value: 'rgba(52, 211, 153, 0.35)' },
  { name: 'blue', value: 'rgba(96, 165, 250, 0.35)' },
  { name: 'pink', value: 'rgba(244, 114, 182, 0.35)' },
  { name: 'orange', value: 'rgba(251, 146, 60, 0.35)' },
];

export const SHAPE_ORDER: ShapeKind[] = ['rect', 'ellipse', 'arrow'];

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  arrow: 'Arrow',
};

export function nextShapeKind(k: ShapeKind): ShapeKind {
  return SHAPE_ORDER[(SHAPE_ORDER.indexOf(k) + 1) % SHAPE_ORDER.length];
}

/** Стрелка без площади: пастель на ней не читается, делаем плотнее. */
export function strokeFor(fill: string): string {
  return fill.replace(/[\d.]+\)$/, '0.95)');
}

/** Порог, отделяющий клик-удаление от рисования. Без него каждое удаление
 *  порождало бы вырожденную фигуру нулевого размера. */
export const DRAG_THRESHOLD_PX = 5;

export function isDegenerate(s: Shape, areaW: number, areaH: number): boolean {
  return Math.abs(s.x2 - s.x1) * areaW < DRAG_THRESHOLD_PX && Math.abs(s.y2 - s.y1) * areaH < DRAG_THRESHOLD_PX;
}

function pointInRect(px: number, py: number, s: Shape): boolean {
  const [x1, x2] = [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)];
  const [y1, y2] = [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)];
  return px >= x1 && px <= x2 && py >= y1 && py <= y2;
}

function pointInEllipse(px: number, py: number, s: Shape): boolean {
  const cx = (s.x1 + s.x2) / 2;
  const cy = (s.y1 + s.y2) / 2;
  const rx = Math.abs(s.x2 - s.x1) / 2;
  const ry = Math.abs(s.y2 - s.y1) / 2;
  if (rx === 0 || ry === 0) return false;
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function pointNearSegment(px: number, py: number, s: Shape, tol: number): boolean {
  const vx = s.x2 - s.x1;
  const vy = s.y2 - s.y1;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return false;
  let t = ((px - s.x1) * vx + (py - s.y1) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = s.x1 + t * vx;
  const cy = s.y1 + t * vy;
  return Math.hypot(px - cx, py - cy) <= tol;
}

/** Верхняя фигура под точкой. При перекрытии удаляется именно она (§6а). */
export function hitTest(shapes: Shape[], px: number, py: number, aspect: number): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    const hit =
      s.kind === 'rect'
        ? pointInRect(px, py, s)
        : s.kind === 'ellipse'
          ? pointInEllipse(px, py, s)
          : pointNearSegment(px, py, s, 0.02 / Math.max(aspect, 0.1));
    if (hit) return s;
  }
  return null;
}

/** Путь толстой стрелки: наконечник на второй точке. */
export function arrowPath(s: Shape, w: number, h: number): string {
  const x1 = s.x1 * w;
  const y1 = s.y1 * h;
  const x2 = s.x2 * w;
  const y2 = s.y2 * h;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  const head = Math.min(len * 0.38, Math.max(18, len * 0.22));
  const shaft = Math.max(5, Math.min(head * 0.42, len * 0.1));
  const wing = head * 0.55;

  const bx = x2 - ux * head;
  const by = y2 - uy * head;

  const p = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
  return (
    `M ${p(x1 + nx * shaft, y1 + ny * shaft)} ` +
    `L ${p(bx + nx * shaft, by + ny * shaft)} ` +
    `L ${p(bx + nx * wing, by + ny * wing)} ` +
    `L ${p(x2, y2)} ` +
    `L ${p(bx - nx * wing, by - ny * wing)} ` +
    `L ${p(bx - nx * shaft, by - ny * shaft)} ` +
    `L ${p(x1 - nx * shaft, y1 - ny * shaft)} Z`
  );
}
