// Горячие клавиши (§13). Комбинации с Ctrl не используем: они конфликтуют
// с шорткатами Chrome, а часть страница не может перехватить вовсе.

export type Command =
  | 'next'
  | 'prev'
  | 'first'
  | 'last'
  | 'mode'
  | 'captions'
  | 'lang'
  | 'gemini'
  | 'flag'
  | 'export'
  | 'fullscreen'
  | 'shapeKind'
  | 'clearSlide'
  | 'clearAll';

export const HOTKEY_HELP: { keys: string; label: string }[] = [
  { keys: '→ / Space / PgDn', label: 'Next slide' },
  { keys: '← / PgUp', label: 'Previous slide' },
  { keys: 'Home / End', label: 'First / last slide' },
  { keys: 'M', label: 'Cycle mode' },
  { keys: 'H', label: 'Show / hide captions' },
  { keys: 'L', label: 'Microphone language' },
  { keys: 'G', label: 'Switch mic to Gemini and back' },
  { keys: 'B', label: 'Flag last log entry' },
  { keys: 'E', label: 'Export transcripts' },
  { keys: 'F', label: 'Fullscreen presentation' },
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

  const k = e.key.toLowerCase();
  if (k === 'q') return e.shiftKey ? 'clearAll' : 'clearSlide';
  if (e.shiftKey) return null;

  switch (k) {
    case 'm':
      return 'mode';
    case 'h':
      return 'captions';
    case 'l':
      return 'lang';
    case 'g':
      return 'gemini';
    case 'b':
      return 'flag';
    case 'e':
      return 'export';
    case 'f':
      return 'fullscreen';
    default:
      return null;
  }
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
