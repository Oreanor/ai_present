// Мелкие форматтеры. Жили копиями в трёх местах и успели разойтись.

/** `MM:SS` из секунд. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** `MM:SS` из миллисекунд — метки времени в стенограмме. */
export function stamp(ms: number): string {
  return clock(ms / 1000);
}

/** Доллары. Мелкие суммы с тремя знаками, иначе на экране всегда «$0.00». */
export function usd(value: number): string {
  return `$${value < 0.01 ? value.toFixed(3) : value.toFixed(2)}`;
}
