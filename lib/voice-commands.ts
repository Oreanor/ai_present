import type { StringKey } from './ui-prefs';
import { ALL_LANGS, type Lang } from './types';

/**
 * Голосовое управление показом.
 *
 * Команда начинается с обращения: «давай дальше», «давай седьмой», «давай
 * общий». Без него слушать нельзя — слово «дальше» посреди фразы это слово,
 * а не приказ, и доклад листался бы сам собой. С обращением ошибиться почти
 * невозможно: «давай» в начале реплики, за которым идёт ровно одна из
 * известных целей, в обычной речи не встречается.
 *
 * Совпавшая реплика в лог не пишется: это управление, а не то, что было
 * сказано залу.
 */
export type VoiceCommand =
  | { kind: 'next' | 'prev' | 'first' | 'last' | 'overview' }
  | { kind: 'goto'; slide: number };

/** Обращение, с которого начинается команда. */
const WAKE: Record<Lang, string[]> = {
  ru: ['давай', 'давайте'],
  en: ['go', 'lets go', 'let us go'],
  pt: ['vamos', 'vai'],
};

/** Цели без номера. */
const TARGETS: Record<Lang, Record<string, VoiceCommand['kind']>> = {
  ru: {
    дальше: 'next',
    вперёд: 'next',
    вперед: 'next',
    следующий: 'next',
    'следующий слайд': 'next',
    назад: 'prev',
    обратно: 'prev',
    предыдущий: 'prev',
    'предыдущий слайд': 'prev',
    первый: 'first',
    'в начало': 'first',
    последний: 'last',
    'в конец': 'last',
    общий: 'overview',
    'общий вид': 'overview',
    обзор: 'overview',
    все: 'overview',
    всё: 'overview',
  },
  en: {
    next: 'next',
    forward: 'next',
    'next slide': 'next',
    back: 'prev',
    previous: 'prev',
    'previous slide': 'prev',
    first: 'first',
    'to the start': 'first',
    last: 'last',
    'to the end': 'last',
    overview: 'overview',
    all: 'overview',
    'all slides': 'overview',
  },
  pt: {
    seguinte: 'next',
    próximo: 'next',
    proximo: 'next',
    frente: 'next',
    anterior: 'prev',
    atrás: 'prev',
    atras: 'prev',
    voltar: 'prev',
    primeiro: 'first',
    'ao início': 'first',
    'ao inicio': 'first',
    último: 'last',
    ultimo: 'last',
    'ao fim': 'last',
    geral: 'overview',
    todos: 'overview',
    'todos os diapositivos': 'overview',
  },
};

/**
 * Порядковые числительные. Распознаватель отдаёт то «седьмой», то «7» —
 * принимаем и то, и другое. Двадцати хватает: колода длиннее двадцати
 * слайдов голосом всё равно не листается, там нужен обзор.
 */
const ORDINALS: Record<Lang, string[]> = {
  ru: [
    'первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый', 'десятый',
    'одиннадцатый', 'двенадцатый', 'тринадцатый', 'четырнадцатый', 'пятнадцатый', 'шестнадцатый',
    'семнадцатый', 'восемнадцатый', 'девятнадцатый', 'двадцатый',
  ],
  en: [
    'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
    'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth',
    'seventeenth', 'eighteenth', 'nineteenth', 'twentieth',
  ],
  pt: [
    'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'sétimo', 'oitavo', 'nono', 'décimo',
    'décimo primeiro', 'décimo segundo', 'décimo terceiro', 'décimo quarto', 'décimo quinto', 'décimo sexto',
    'décimo sétimo', 'décimo oitavo', 'décimo nono', 'vigésimo',
  ],
};

/** Длиннее этого команда не бывает, а обычная фраза — сплошь и рядом. */
const MAX_CHARS = 32;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Разбор реплики. Языки проверяются все сразу: приколотый к английскому
 * распознаватель, услышав «давай дальше», отдаст что угодно, и привязка к
 * языку реплики только мешала бы. Слова из разных списков не пересекаются.
 */
export function matchVoiceCommand(text: string): VoiceCommand | null {
  const clean = normalise(text);
  if (!clean || clean.length > MAX_CHARS) return null;

  for (const lang of ALL_LANGS) {
    for (const wake of WAKE[lang]) {
      if (!clean.startsWith(wake + ' ')) continue;
      const rest = clean.slice(wake.length + 1).trim();
      if (!rest) continue;

      const kind = TARGETS[lang][rest];
      if (kind) return kind === 'goto' ? null : { kind };

      // «давай 7» — номер цифрами.
      if (/^\d{1,3}$/.test(rest)) return { kind: 'goto', slide: Number(rest) };

      // «давай седьмой» — номер словом. Хвост «слайд» не мешает.
      const words = rest.replace(/\s+(слайд|slide|diapositivo)$/u, '');
      const i = ORDINALS[lang].indexOf(words);
      if (i >= 0) return { kind: 'goto', slide: i + 1 };
    }
  }
  return null;
}

/**
 * Справка по командам — на языке РЕЧИ, а не интерфейса: произносить их
 * надо на том языке, на который сейчас настроен микрофон, и показывать
 * их на другом значит показывать то, что не сработает.
 *
 * Строится из тех же списков, что и разбор. Дописать команду — значит
 * дописать её в одном месте, а не в двух, которые потом разъедутся.
 */
export function commandHelp(lang: Lang): { phrase: string; label: StringKey }[] {
  const wake = WAKE[lang][0];
  const first = (kind: VoiceCommand['kind']) =>
    Object.entries(TARGETS[lang]).find(([, k]) => k === kind)?.[0];

  const rows: { phrase: string; label: StringKey }[] = [];
  const add = (target: string | undefined, label: StringKey) => {
    if (target) rows.push({ phrase: `${wake} ${target}`, label });
  };

  add(first('next'), 'cmdNext');
  add(first('prev'), 'cmdPrev');
  add(first('first'), 'cmdFirst');
  add(first('last'), 'cmdLast');
  // Седьмой — просто пример: годится любой номер, словом или цифрой.
  add(ORDINALS[lang][6], 'cmdGoto');
  add(first('overview'), 'cmdOverview');
  return rows;
}
