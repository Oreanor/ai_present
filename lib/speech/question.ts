import type { Lang } from '../types';

/**
 * Восстановление вопросительного знака в хвостовых вопросах.
 *
 * Зачем это вообще нужно. Web Speech отдаёт текст, а знаки препинания
 * дописывает отдельная текстовая модель — уже после того, как звук
 * выброшен. Интонацию она не слышит по устройству, поэтому «Круто, да?»
 * приезжает точкой, сколько ни старайся голосом.
 *
 * Полностью это не лечится: вопрос, заданный ОДНОЙ интонацией, отличить
 * не по чему. Но хвостовой вопрос отличается ещё и словом — «…, да»,
 * «…, right», «…, né». Его и ловим: это ровно тот случай, который
 * встречается в разговоре чаще всего.
 *
 * Список намеренно короткий. Каждое слово здесь почти никогда не
 * заканчивает утверждение, поэтому ложных вопросов не будет; ловить
 * побольше ценой знаков вопроса в утверждениях — плохой размен.
 */
const TAGS: Record<Lang, string[]> = {
  ru: ['да', 'верно', 'правда', 'не так ли', 'согласны', 'ок'],
  en: ['right', "isn't it", "aren't they", "don't you", 'correct', 'yeah'],
  pt: ['não', 'né', 'certo', 'não é', 'pois não'],
};

const ENDS_SENTENCE = /[.!?…]+$/;

export function restoreQuestionMark(text: string, lang: Lang): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.endsWith('?')) return trimmed;

  // Хвост — то, что после последней запятой. Без запятой хвостового
  // вопроса не бывает: «да» в начале фразы это согласие, а не вопрос.
  const comma = trimmed.lastIndexOf(',');
  if (comma < 0) return trimmed;

  const tail = trimmed
    .slice(comma + 1)
    .replace(ENDS_SENTENCE, '')
    .trim()
    .toLowerCase();

  if (!TAGS[lang].includes(tail)) return trimmed;
  return trimmed.replace(ENDS_SENTENCE, '') + '?';
}
