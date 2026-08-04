// Горячие клавиши (§13). Комбинации с Ctrl не используем: они конфликтуют
// с шорткатами Chrome, а часть страница не может перехватить вовсе.

export type Command = 'next' | 'prev' | 'first' | 'last' | 'shapeKind' | 'clearSlide' | 'clearAll';

/**
 * Список намеренно короткий. Буквенных сокращений было ещё восемь — на
 * старт, язык микрофона, движок, экспорт, метку, полноэкранный режим.
 * Их никто не запоминает: у всего этого есть кнопка на виду, а клавиша
 * рядом с ней только требует помнить лишнее. Осталось то, что и так
 * знают: листание (его же шлёт презентационный пульт) и две клавиши
 * разметки, которые нажимают с рукой на мыши.
 */
export const HOTKEY_HELP: { keys: string; label: string }[] = [
  { keys: '→ / Space / PgDn', label: 'Next slide' },
  { keys: '← / PgUp', label: 'Previous slide' },
  { keys: 'Home / End', label: 'First / last slide' },
  { keys: 'Tab', label: 'Annotation shape' },
  { keys: 'Q', label: 'Clear annotations on slide' },
  { keys: 'Shift+Q', label: 'Clear all annotations' },
];

/** Пока фокус в поле ввода — хоткеи отключены целиком. Иначе буква «h»
 *  в поиске по логу гасила бы субтитры перед зрителями. */
function inTextField(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function resolve(e: KeyboardEvent): Command | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;

  switch (e.key) {
    case 'ArrowRight':
    case ' ':
    case 'PageDown':
      return 'next';
    case 'ArrowLeft':
    case 'PageUp':
      return 'prev';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    case 'Tab':
      return 'shapeKind';
  }

  if (e.key.toLowerCase() === 'q') return e.shiftKey ? 'clearAll' : 'clearSlide';
  return null;
}

export function attachHotkeys(handler: (c: Command) => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (inTextField(e.target)) return;
    const cmd = resolve(e);
    if (!cmd) return;
    // Tab по умолчанию уводит фокус, пробел прокручивает страницу.
    e.preventDefault();
    handler(cmd);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
