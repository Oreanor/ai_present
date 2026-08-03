'use client';

import { useRef, useState } from 'react';
import type { Shape, ShapeKind } from '@/lib/types';
import { ANNOTATION } from '@/lib/constants';
import { arrowPath, hitTest } from '@/lib/geometry';
import { strokeFor } from '@/lib/shapes';

/**
 * Разметка поверх слайда (§6а). SVG-слой над canvas, а не рисование в canvas
 * и не аннотации PDF: исходный файл не изменяется никогда.
 *
 * Координаты нормализованы к области слайда (0..1) — окно меняет размер,
 * Teams масштабирует, переключение reserve/overlay двигает слайд.
 */
export function AnnotationLayer({
  shapes,
  rect,
  interactive,
  kind,
  color,
  onAdd,
  onRemove,
  onUndo,
}: {
  shapes: Shape[];
  rect: { x: number; y: number; w: number; h: number };
  interactive: boolean;
  kind?: ShapeKind;
  color?: string;
  onAdd?: (s: Omit<Shape, 'id'>) => void;
  onRemove?: (id: string) => void;
  onUndo?: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Omit<Shape, 'id'> | null>(null);
  const startRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const toLocal = (e: React.PointerEvent | React.MouseEvent) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return {
      x: (e.clientX - box.left) / box.width,
      y: (e.clientY - box.top) / box.height,
      px: e.clientX,
      py: e.clientY,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || e.button !== 0) return;
    const p = toLocal(e);
    if (!p) return;
    startRef.current = p;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const start = startRef.current;
    if (!interactive || !start || !kind || !color) return;
    const p = toLocal(e);
    if (!p) return;
    // Ниже порога считаем это кликом-удалением, а не рисованием: иначе
    // каждое удаление порождало бы вырожденную фигуру нулевого размера.
    if (Math.hypot(p.px - start.px, p.py - start.py) < ANNOTATION.DRAG_THRESHOLD_PX) return;
    setDraft({ kind, color, x1: start.x, y1: start.y, x2: p.x, y2: p.y });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const start = startRef.current;
    startRef.current = null;
    if (!interactive || !start) return;
    const p = toLocal(e);
    if (!p) return;

    const moved = Math.hypot(p.px - start.px, p.py - start.py);
    if (moved < ANNOTATION.DRAG_THRESHOLD_PX) {
      // Клик — удаляем верхнюю фигуру под курсором.
      const hit = hitTest(shapes, p.x, p.y, rect.w / Math.max(rect.h, 1));
      if (hit) onRemove?.(hit.id);
    } else if (kind && color) {
      // Фигуру строим из точек нажатия и отпускания, а НЕ из draft:
      // быстрый жест может не дать ни одного промежуточного события,
      // и тогда фигура терялась бы молча.
      onAdd?.({ kind, color, x1: start.x, y1: start.y, x2: p.x, y2: p.y });
    }
    setDraft(null);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if (!interactive) return;
    // Без preventDefault поверх расшаренного экрана всплывёт меню Chrome.
    e.preventDefault();
    onUndo?.();
  };

  const all = draft ? [...shapes, { ...draft, id: '__draft' }] : shapes;
  const W = 1000;
  const H = rect.h && rect.w ? (1000 * rect.h) / rect.w : 562;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="absolute"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        pointerEvents: interactive ? 'auto' : 'none',
        cursor: interactive ? 'crosshair' : undefined,
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={onContextMenu}
    >
      {all.map((s) => {
        const x = Math.min(s.x1, s.x2) * W;
        const y = Math.min(s.y1, s.y2) * H;
        const w = Math.abs(s.x2 - s.x1) * W;
        const h = Math.abs(s.y2 - s.y1) * H;

        if (s.kind === 'rect')
          return <rect key={s.id} x={x} y={y} width={w} height={h} fill={s.color} rx={Math.min(w, h) * 0.03} />;
        if (s.kind === 'ellipse')
          return (
            <ellipse key={s.id} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={s.color} />
          );
        return <path key={s.id} d={arrowPath(s, W, H)} fill={strokeFor(s.color)} />;
      })}
    </svg>
  );
}
