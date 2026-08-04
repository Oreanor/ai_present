import { ALL_LANGS, type Lang } from './types';

/**
 * Пасхалка: на крепкое слово слайд на пару секунд прячется, а вместо него
 * появляются извинения — на языке того, кто выразился.
 *
 * Списки нарочно короткие и без пограничных случаев. Это срабатывает на
 * расшаренном экране перед залом, поэтому ложное срабатывание дороже
 * пропущенного: «merda» и «porra» в бразильской речи идут через слово, и
 * с ними слайд мигал бы весь доклад.
 *
 * Реплика при этом остаётся в логе как есть. Сказанное было сказано, и
 * подчищать за говорящим стенограмму — не наше дело.
 */
const WORDS: Record<Lang, string[]> = {
  en: ['fuck', 'fucking', 'fucked', 'motherfucker'],
  pt: ['fodese', 'fodase', 'caralho', 'filha da puta', 'filho da puta'],
  ru: ['блядь', 'бляди', 'сука', 'пиздец', 'нахуй'],
};

/** Извинения — на языке ругательства, а не интерфейса: смешно именно это. */
export const APOLOGY: Record<Lang, string> = {
  en: 'Sorry for the inconvenience',
  pt: 'Pedimos desculpa pelo incómodo',
  ru: 'Приносим извинения за неудобства',
};

/**
 * Язык ругательства, если оно есть.
 *
 * Односложные ищем по границам слова, составные — как подстроку: дефисы и
 * пробелы распознаватель ставит как ему вздумается, и «foda-se» приезжает
 * то «fodase», то «foda se».
 */
export function detectProfanity(text: string): Lang | null {
  const clean = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;

  const tokens = new Set(clean.split(' '));
  for (const lang of ALL_LANGS) {
    for (const w of WORDS[lang]) {
      if (w.includes(' ') ? clean.includes(w) : tokens.has(w)) return lang;
    }
  }
  return null;
}
