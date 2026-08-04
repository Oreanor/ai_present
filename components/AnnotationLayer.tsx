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
  onMove,
  onUndo,
}: {
  shapes: Shape[];
  rect: { x: number; y: number; w: number; h: number };
  interactive: boolean;
  kind?: ShapeKind;
  color?: string;
  onAdd?: (s: Omit<Shape, 'id'>) => void;
  onRemove?: (id: string) => void;
  onMove?: (id: string, dx: number, dy: number) => void;
  onUndo?: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Omit<Shape, 'id'> | null>(null);
  // Живой сдвиг перетаскиваемой фигуры: в стор он попадает один раз,
  // на отпускании, иначе каждое движение мыши писало бы в localStorage.
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [overShape, setOverShape] = useState(false);
  const startRef = useRef<{ x: number; y: number; px: number; py: number; grabbed: string | null } | null>(null);

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

  const pick = (x: number, y: number) => hitTest(shapes, x, y, rect.w / Math.max(rect.h, 1));

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || e.button !== 0) return;
    const p = toLocal(e);
    if (!p) return;
    // Нажатие на существующую фигуру — это захват, а не начало новой.
    // Рисовать поверх уже размеченного места всё равно некуда, а поправить
    // промах хочется постоянно.
    startRef.current = { ...p, grabbed: pick(p.x, p.y)?.id ?? null };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toLocal(e);
    if (!interactive || !p) return;
    const start = startRef.current;

    if (!start) {
      // Курсор подсказывает, что под ним фигуру можно потащить.
      setOverShape(!!pick(p.x, p.y));
      return;
    }

    // Ниже порога считаем это кликом-удалением, а не жестом: иначе каждое
    // удаление порождало бы вырожденную фигуру нулевого размера.
    if (Math.hypot(p.px - start.px, p.py - start.py) < ANNOTATION.DRAG_THRESHOLD_PX) return;

    if (start.grabbed) setDrag({ id: start.grabbed, dx: p.x - start.x, dy: p.y - start.y });
    else if (kind && color) setDraft({ kind, color, x1: start.x, y1: start.y, x2: p.x, y2: p.y });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const start = startRef.current;
    startRef.current = null;
    setDraft(null);
    setDrag(null);
    if (!interactive || !start) return;
    const p = toLocal(e);
    if (!p) return;

    const moved = Math.hypot(p.px - start.px, p.py - start.py);
    if (moved < ANNOTATION.DRAG_THRESHOLD_PX) {
      // Клик без движения — удаляем верхнюю фигуру под курсором.
      if (start.grabbed) onRemove?.(start.grabbed);
    } else if (start.grabbed) {
      onMove?.(start.grabbed, p.x - start.x, p.y - start.y);
    } else if (kind && color) {
      // Фигуру строим из точек нажатия и отпускания, а НЕ из draft:
      // быстрый жест может не дать ни одного промежуточного события,
      // и тогда фигура терялась бы молча.
      onAdd?.({ kind, color, x1: start.x, y1: start.y, x2: p.x, y2: p.y });
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if (!interactive) return;
    // Без preventDefault поверх расшаренного экрана всплывёт меню Chrome.
    e.preventDefault();
    onUndo?.();
  };

  const placed = drag
    ? shapes.map((s) =>
        s.id === drag.id
          ? { ...s, x1: s.x1 + drag.dx, y1: s.y1 + drag.dy, x2: s.x2 + drag.dx, y2: s.y2 + drag.dy }
          : s,
      )
    : shapes;
  const all = draft ? [...placed, { ...draft, id: '__draft' }] : placed;
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
        cursor: !interactive ? undefined : drag || overShape ? 'move' : 'crosshair',
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
