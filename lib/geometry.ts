import { ANNOTATION, SIDE_COLUMN } from './constants';
import type { Shape } from './types';

// Вся геометрия в одном месте. Раньше она была размазана между рендером
// PDF, разметкой и боковой колонкой, хотя это один и тот же расчёт:
// куда попадает прямоугольник внутри области и что остаётся вокруг.

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Вписывание `contain` по ОБЕИМ осям (§6). Подгонка только по ширине
 * уводит низ кадра за границу окна вместе с субтитрами.
 */
export function fitContain(areaW: number, areaH: number, aspect: number): Rect {
  let w = areaW;
  let h = w / aspect;
  if (h > areaH) {
    h = areaH;
    w = h * aspect;
  }
  return { x: (areaW - w) / 2, y: (areaH - h) / 2, w, h };
}

/**
 * Какая доля ширины остаётся свободной сбоку при вписывании слайда.
 * Потолок обязателен: у портретной колоды остаток около 60%, и колонка
 * субтитров получилась бы шире слайда.
 */
export function sideRoom(windowAspect: number, slideAspect: number): number {
  if (slideAspect >= windowAspect) return 0;
  return Math.min(1 - slideAspect / windowAspect, SIDE_COLUMN.MAX_FRACTION);
}

// --- попадание по фигурам разметки ----------------------------------------

function inRect(px: number, py: number, s: Shape): boolean {
  const [x1, x2] = [Math.min(s.x1, s.x2), Math.max(s.x1, s.x2)];
  const [y1, y2] = [Math.min(s.y1, s.y2), Math.max(s.y1, s.y2)];
  return px >= x1 && px <= x2 && py >= y1 && py <= y2;
}

function inEllipse(px: number, py: number, s: Shape): boolean {
  const rx = Math.abs(s.x2 - s.x1) / 2;
  const ry = Math.abs(s.y2 - s.y1) / 2;
  if (rx === 0 || ry === 0) return false;
  const dx = (px - (s.x1 + s.x2) / 2) / rx;
  const dy = (py - (s.y1 + s.y2) / 2) / ry;
  return dx * dx + dy * dy <= 1;
}

function nearSegment(px: number, py: number, s: Shape, tol: number): boolean {
  const vx = s.x2 - s.x1;
  const vy = s.y2 - s.y1;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return false;
  const t = Math.max(0, Math.min(1, ((px - s.x1) * vx + (py - s.y1) * vy) / len2));
  return Math.hypot(px - (s.x1 + t * vx), py - (s.y1 + t * vy)) <= tol;
}

/** Верхняя фигура под точкой: при перекрытии удаляется именно она (§6а). */
export function hitTest(shapes: Shape[], px: number, py: number, aspect: number): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    const hit =
      s.kind === 'rect'
        ? inRect(px, py, s)
        : s.kind === 'ellipse'
          ? inEllipse(px, py, s)
          : nearSegment(px, py, s, ANNOTATION.ARROW_HIT_TOLERANCE / Math.max(aspect, 0.1));
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
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
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
