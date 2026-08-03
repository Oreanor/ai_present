// Помощник расстановки окон (§1). Целевая конфигурация — ОДИН монитор,
// окна делят экран и не перекрываются: перекрытое окно Chrome перестаёт
// перерисовывать, а Teams продолжает транслировать зрителям застывший кадр,
// причём ведущий у себя видит нормальную картинку.

import { routes } from './routes';

export const PRESENT_WINDOW_NAME = 'aip-presentation';

export type Layout = { present: Rect; control: Rect };
type Rect = { left: number; top: number; width: number; height: number };

/**
 * Presentation получает родное 16:9 — иначе зрители получают чёрные поля.
 * Control занимает остаток ширины узкой колонкой.
 */
export function computeLayout(aspect = 16 / 9): Layout {
  // availLeft/availTop не в стандартном Screen, но есть в Chrome и нужны
  // для многомониторных конфигураций.
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  const sw = screen.availWidth;
  const sh = screen.availHeight;
  const left = screen.availLeft ?? 0;
  const top = screen.availTop ?? 0;

  // Control не уже 380 и не шире трети экрана: иначе слайд становится мелким.
  const controlW = Math.round(Math.min(Math.max(sw * 0.26, 380), sw / 3));
  let presentW = sw - controlW;
  let presentH = Math.round(presentW / aspect);
  if (presentH > sh) {
    presentH = sh;
    presentW = Math.round(presentH * aspect);
  }

  return {
    present: { left, top, width: presentW, height: presentH },
    control: { left: left + sw - controlW, top, width: controlW, height: sh },
  };
}

export function openPresentation(aspect?: number): Window | null {
  const { present } = computeLayout(aspect);
  const features = `popup=yes,width=${present.width},height=${present.height},left=${present.left},top=${present.top}`;
  const w = window.open(routes.present, PRESENT_WINDOW_NAME, features);
  w?.focus();
  return w;
}

/** Переставить уже открытые окна. moveTo/resizeTo работают только для окон,
 *  открытых скриптом, поэтому Presentation двигаем через его ссылку. */
export function arrange(presentWindow: Window | null, aspect?: number): void {
  const { present, control } = computeLayout(aspect);
  try {
    presentWindow?.resizeTo(present.width, present.height);
    presentWindow?.moveTo(present.left, present.top);
  } catch {
    /* окно закрыли или открыли вручную — переставим что сможем */
  }
  try {
    window.resizeTo(control.width, control.height);
    window.moveTo(control.left, control.top);
  } catch {
    /* Chrome не даёт двигать окно, которое не открывал скрипт */
  }
}
