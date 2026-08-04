import type { StringKey } from './ui-prefs';
import { ALL_LANGS, type Lang, type LangMode, type Speaker } from './types';

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
  | { kind: 'next' | 'prev' | 'first' | 'last' | 'overview' | 'close' }
  | { kind: 'goto'; slide: number }
  | { kind: 'open'; deck: number }
  | { kind: 'readIn'; lang: Lang }
  | { kind: 'channel'; who: Speaker; mode: LangMode };

/**
 * Что сейчас на экране. Команда, которой некуда сработать, командой не
 * считается: «закрой», сказанное над галереей, это слово, а не приказ, и
 * реплику надо отдать в лог, а не съесть. Поэтому проверка стоит в разборе,
 * а не в исполнении — иначе несработавшая команда пропадала бы молча.
 */
export type VoiceContext = { deckOpen: boolean };

/** Обращение, с которого начинается команда. */
const WAKE: Record<Lang, string[]> = {
  ru: ['давай', 'давайте'],
  en: ['go', 'lets go', 'let us go'],
  pt: ['vamos', 'vai'],
};

/** Виды команд, которым, кроме себя, ничего не нужно: ни номера, ни языка.
 *  Только они и лежат в TARGETS — остальные разбираются отдельно. */
type PlainKind = 'next' | 'prev' | 'first' | 'last' | 'overview';

/** Цели без номера. */
const TARGETS: Record<Lang, Record<string, PlainKind>> = {
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

/**
 * Открыть презентацию из галереи и закрыть текущую.
 *
 * Обращения «давай» здесь нет: глагол служит им сам. «Открой» и «закрой»
 * в повелительном наклонении посреди доклада не встречаются, а привязка
 * к состоянию экрана убирает и остаток риска — «закрой» имеет силу только
 * когда есть что закрывать.
 */
// Первым в каждом списке — то, что показывает справка. Существительное
// после числительного снимает TRAIL_NOUN, поэтому «открой первую» и
// «открой первую презентацию» ловятся одним глаголом.
const OPEN: Record<Lang, string[]> = {
  ru: ['открой', 'откройте'],
  en: ['open'],
  pt: ['abre', 'abrir'],
};

const CLOSE: Record<Lang, string[]> = {
  ru: ['закрой', 'закройте', 'закрой презентацию', 'закройте презентацию'],
  en: ['close', 'close presentation'],
  pt: ['fecha', 'fechar', 'fecha a apresentação', 'fechar a apresentação'],
};

/**
 * Числительные для презентаций. Отдельно от ORDINALS, потому что
 * «презентация» женского рода: «открой пер­ВУЮ», а не «первый». Мужские
 * формы принимаем заодно — оговорка дешевле непонятой команды.
 *
 * Словарём, а не списком: у «четвёртой» две записи, через «ё» и через «е»,
 * и распознаватель ставит их как ему вздумается. Десяти хватает: галерея
 * недавних длиннее не бывает.
 */
const DECK_ORDINALS: Record<Lang, Record<string, number>> = {
  ru: {
    первую: 1, первый: 1,
    вторую: 2, второй: 2,
    третью: 3, третий: 3,
    'четвёртую': 4, четвертую: 4, 'четвёртый': 4, четвертый: 4,
    пятую: 5, пятый: 5,
    шестую: 6, шестой: 6,
    'седьмую': 7, 'седьмой': 7,
    'восьмую': 8, 'восьмой': 8,
    девятую: 9, девятый: 9,
    десятую: 10, десятый: 10,
  },
  en: {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
    sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  },
  pt: {
    primeira: 1, primeiro: 1,
    segunda: 2, segundo: 2,
    terceira: 3, terceiro: 3,
    quarta: 4, quarto: 4,
    quinta: 5, quinto: 5,
    sexta: 6, sexto: 6,
    'sétima': 7, setima: 7, 'sétimo': 7, setimo: 7,
    oitava: 8, oitavo: 8,
    nona: 9, nono: 9,
    'décima': 10, decima: 10, 'décimo': 10, decimo: 10,
  },
};

/**
 * Язык чтения — то же, что «Ler em» в панели. Работает и над галереей, и
 * посреди доклада: это не про колоду, а про то, на каком языке читают
 * ленту и слайды, и привязывать его к состоянию экрана незачем.
 */
const READ_IN: Record<Lang, string[]> = {
  ru: ['вруби', 'врубите', 'включи', 'включите', 'читай на', 'читаем на'],
  en: ['read in', 'switch to', 'turn on'],
  pt: ['ler em', 'lê em', 'liga', 'ligar', 'muda para'],
};

/** Как называют языки на каждом из языков. Своё название тоже принимаем:
 *  «вруби русский», сказанное по-русски, — обычная просьба. */
const LANG_WORDS: Record<Lang, Record<string, Lang>> = {
  ru: {
    'английский': 'en', 'англ': 'en', 'английском': 'en', 'инглиш': 'en',
    'португальский': 'pt', 'порт': 'pt', 'португальском': 'pt',
    'русский': 'ru', 'рус': 'ru', 'русском': 'ru',
  },
  en: {
    english: 'en', portuguese: 'pt', russian: 'ru',
  },
  pt: {
    'inglês': 'en', ingles: 'en',
    'português': 'pt', portugues: 'pt',
    russo: 'ru',
  },
};

/**
 * Язык РАСПОЗНАВАНИЯ канала — то же, что чипы «M» и «R» в панели.
 * Не путать с языком чтения: тот про то, что видно, этот про то, что
 * слышно. Канал называется существительным, дальше идёт язык или «авто».
 */
const CHANNEL_WORDS: Record<Lang, Record<string, Speaker>> = {
  ru: {
    // «Мне» первым: короткое местоимение распознаётся надёжнее «лектора»,
    // который приезжает то «лекторам», то «Professor». И дательный падеж
    // снимает двусмысленность именительного: «я русский» — обычная фраза,
    // которую в докладе про языки говорят, а «мне русский» — нет.
    'мне': 'presenter',
    'лектор': 'presenter', 'лектора': 'presenter', 'докладчик': 'presenter',
    'ведущий': 'presenter', 'микрофон': 'presenter',
    'зал': 'audience', 'зала': 'audience', 'аудитория': 'audience', 'комната': 'audience',
  },
  en: {
    me: 'presenter', 'for me': 'presenter',
    presenter: 'presenter', speaker: 'presenter', mic: 'presenter', microphone: 'presenter',
    // «Лектор», сказанное в приколотый к латинице распознаватель, приезжает
    // как «professor»: слышит он то, что умеет, а не то, что сказано.
    professor: 'presenter', lecturer: 'presenter',
    room: 'audience', audience: 'audience',
  },
  pt: {
    mim: 'presenter', 'para mim': 'presenter',
    orador: 'presenter', apresentador: 'presenter', microfone: 'presenter',
    // В португальском это к тому же прямое слово для докладчика.
    professor: 'presenter',
    sala: 'audience', 'audiência': 'audience', audiencia: 'audience',
  },
};

/** «Авто» — определение языка моделью, а не приколотый язык. */
const AUTO_WORDS: Record<Lang, string[]> = {
  ru: ['авто', 'автомат', 'автоматически', 'автоматом'],
  en: ['auto', 'automatic', 'detect'],
  pt: ['auto', 'automático', 'automatico', 'detetar'],
};

/** Артикль спереди и существительное сзади команде не мешают:
 *  «open the first presentation» — та же команда, что «open first». */
const LEAD_ARTICLE = /^(the|a|o|as|os)\s+/u;
const TRAIL_NOUN = /\s+(презентацию|презентация|презентации|presentation|deck|apresentação|apresentacao)$/u;

/** Номер презентации из хвоста команды: словом или цифрой. */
function deckNumber(lang: Lang, tail: string): number | null {
  let rest = tail.trim().replace(LEAD_ARTICLE, '').replace(TRAIL_NOUN, '').trim();
  rest = rest.replace(LEAD_ARTICLE, '').trim();
  if (!rest) return null;
  if (/^\d{1,2}$/.test(rest)) {
    const n = Number(rest);
    return n >= 1 ? n : null;
  }
  return DECK_ORDINALS[lang][rest] ?? null;
}

/** Длиннее этого команда не бывает, а обычная фраза — сплошь и рядом. */
const MAX_CHARS = 32;

function normalise(text: string): string {
  return (
    text
      .toLowerCase()
      // Апостроф слово не рвёт: «let's go» — это «lets go», а не «let s go».
      .replace(/['’ʼ`]/gu, '')
      // Всё прочее заменяется ПРОБЕЛОМ, а не пустотой. Иначе дефис склеивал
      // слова: «лектор-авто» превращалось в «лекторавто», и ни одна команда
      // с дефисом или тире внутри не срабатывала. Распознаватель ставит их
      // где хочет, и полагаться на их отсутствие нельзя.
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Разбор реплики. Языки проверяются все сразу: приколотый к английскому
 * распознаватель, услышав «давай дальше», отдаст что угодно, и привязка к
 * языку реплики только мешала бы. Слова из разных списков не пересекаются.
 */
export function matchVoiceCommand(text: string, ctx: VoiceContext): VoiceCommand | null {
  const clean = normalise(text);
  if (!clean || clean.length > MAX_CHARS) return null;

  for (const lang of ALL_LANGS) {
    // Язык распознавания канала: «лектор русский», «зал авто». Работает
    // всегда — канал слушает независимо от того, открыта ли колода.
    for (const [word, who] of Object.entries(CHANNEL_WORDS[lang])) {
      if (!clean.startsWith(word + ' ')) continue;
      const said = clean.slice(word.length + 1).trim().replace(LEAD_ARTICLE, '');
      if (AUTO_WORDS[lang].includes(said)) return { kind: 'channel', who, mode: { kind: 'auto' } };
      const to = LANG_WORDS[lang][said];
      if (to) return { kind: 'channel', who, mode: { kind: 'pin', current: to } };
    }

    // Язык чтения — вне зависимости от того, что на экране.
    for (const verb of READ_IN[lang]) {
      if (!clean.startsWith(verb + ' ')) continue;
      const said = clean.slice(verb.length + 1).trim().replace(LEAD_ARTICLE, '');
      const to = LANG_WORDS[lang][said];
      if (to) return { kind: 'readIn', lang: to };
    }

    // Закрыть можно только открытое.
    if (ctx.deckOpen && CLOSE[lang].includes(clean)) return { kind: 'close' };

    // Открыть — только когда открывать есть куда. Посреди доклада «открой
    // первую» относится к чему угодно, кроме презентации, и листать по
    // такому нельзя.
    if (!ctx.deckOpen) {
      for (const verb of OPEN[lang]) {
        if (!clean.startsWith(verb + ' ')) continue;
        const n = deckNumber(lang, clean.slice(verb.length + 1));
        if (n) return { kind: 'open', deck: n };
      }
      // Листать нечего — дальше в этом языке смотреть не на что.
      continue;
    }

    for (const wake of WAKE[lang]) {
      if (!clean.startsWith(wake + ' ')) continue;
      const rest = clean.slice(wake.length + 1).trim();
      if (!rest) continue;

      const kind = TARGETS[lang][rest];
      if (kind) return { kind };

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
export function commandHelp(lang: Lang, ctx: VoiceContext): { phrase: string; label: StringKey }[] {
  const wake = WAKE[lang][0];
  const first = (kind: VoiceCommand['kind']) =>
    Object.entries(TARGETS[lang]).find(([, k]) => k === kind)?.[0];

  const rows: { phrase: string; label: StringKey }[] = [];
  const add = (target: string | undefined, label: StringKey) => {
    if (target) rows.push({ phrase: `${wake} ${target}`, label });
  };

  // Справка показывает то, что сработает СЕЙЧАС. Показывать над галереей
  // команды листания значит показывать то, что не сработает, — ровно за
  // это справку и ругают.
  // Язык чтения переключается всегда, поэтому строка есть в обоих случаях.
  // В примере — язык, отличный от языка речи: показывать «вруби русский»
  // тому, кто говорит по-русски, значит показывать бесполезное.
  const other = Object.entries(LANG_WORDS[lang]).find(([, l]) => l !== lang)?.[0];
  const always: { phrase: string; label: StringKey }[] = [];
  if (other) always.push({ phrase: `${READ_IN[lang][0]} ${other}`, label: 'cmdReadIn' });

  // Каналы распознавания слушаются всегда — и над галереей, и в докладе.
  const mic = Object.entries(CHANNEL_WORDS[lang]).find(([, w]) => w === 'presenter')?.[0];
  const room = Object.entries(CHANNEL_WORDS[lang]).find(([, w]) => w === 'audience')?.[0];
  if (mic && other) always.push({ phrase: `${mic} ${other}`, label: 'cmdMicLang' });
  if (room) always.push({ phrase: `${room} ${AUTO_WORDS[lang][0]}`, label: 'cmdRoomLang' });

  if (!ctx.deckOpen) {
    const one = Object.entries(DECK_ORDINALS[lang]).find(([, n]) => n === 1)?.[0];
    if (one) rows.push({ phrase: `${OPEN[lang][0]} ${one}`, label: 'cmdOpen' });
    rows.push(...always);
    return rows;
  }

  add(first('next'), 'cmdNext');
  add(first('prev'), 'cmdPrev');
  add(first('first'), 'cmdFirst');
  add(first('last'), 'cmdLast');
  // Седьмой — просто пример: годится любой номер, словом или цифрой.
  add(ORDINALS[lang][6], 'cmdGoto');
  add(first('overview'), 'cmdOverview');
  rows.push(...always);
  rows.push({ phrase: CLOSE[lang][0], label: 'cmdClose' });
  return rows;
}
