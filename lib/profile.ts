import { ALL_LANGS, type Lang, type LangMode, type MeetingProfile } from './types';

// Профиль встречи — ЕДИНСТВЕННОЕ место, где заданы языки (ТЗ §3а).
// Нигде больше в коде не должно быть литералов 'en' / 'pt' / 'ru'
// в смысле «язык ведущего» или «язык субтитров».

/**
 * С чего начинает новый пользователь.
 *
 * Микрофон в пине, зал в авто — конфигурация из §4: своя речь получает
 * секундную задержку и не расходует лимит, а язык вопроса заранее неизвестен.
 * Оба режима перебираются кнопкой канала прямо во время доклада, поэтому
 * ошибиться здесь нестрашно.
 */
export const DEFAULT_PROFILE: MeetingProfile = {
  presenterLangs: ['en'],
  presenterMode: { kind: 'pin', current: 'en' },
  audienceLangs: ['pt', 'en'],
  audienceMode: { kind: 'auto' },
};

/**
 * Язык субтитров — первый язык зала: полосу читает он.
 * Отдельной настройки нет: переключатель над лентой меняет язык показа
 * в любой момент, а спрашивать то же самое ещё и в мастере незачем.
 */
export function captionLangOf(p: MeetingProfile): Lang {
  return p.audienceLangs[0] ?? ALL_LANGS[0];
}

/**
 * Два языка, которые ведутся всегда и целиком: язык ведущего и язык зала.
 * Первый — язык ведущего, на нём фокус лога и выгрузка для себя.
 *
 * Если они совпадают, вторым берём любой другой: две одинаковые
 * стенограммы это одна стенограмма, и половина интерфейса теряет смысл.
 */
export function transcriptLangs(p: MeetingProfile): [Lang, Lang] {
  const first = p.presenterLangs[0] ?? ALL_LANGS[0];
  const second = p.audienceLangs.find((l) => l !== first) ?? ALL_LANGS.find((l) => l !== first) ?? ALL_LANGS[1];
  return [first, second];
}

/**
 * Проблема профиля. Текст НЕ хранится здесь: это слой данных, а слова
 * живут в словаре интерфейса и зависят от языка кнопок. Наружу отдаётся
 * ключ, компонент его переводит.
 */
export type ProfileProblem = { field: string; key: ProblemKey; fatal: boolean };

export type ProblemKey = 'needPresenterLang' | 'needAudienceLang' | 'autoWithOneLang' | 'autoOnMicIsExpensive';

export function validateProfile(p: MeetingProfile): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const add = (field: string, key: ProblemKey, fatal: boolean) => out.push({ field, key, fatal });

  if (p.presenterLangs.length === 0) add('presenterLangs', 'needPresenterLang', true);
  if (p.audienceLangs.length === 0) add('audienceLangs', 'needAudienceLang', true);

  // auto на одном кандидате — бессмысленная трата лимита: определять нечего.
  if (p.presenterMode.kind === 'auto' && p.presenterLangs.length < 2) add('presenterMode', 'autoWithOneLang', false);
  if (p.audienceMode.kind === 'auto' && p.audienceLangs.length < 2) add('audienceMode', 'autoWithOneLang', false);

  // Микрофон в auto — самый дорогой режим: ведущий говорит почти непрерывно.
  if (p.presenterMode.kind === 'auto') add('presenterMode', 'autoOnMicIsExpensive', false);

  return out;
}

export function profileIsUsable(p: MeetingProfile): boolean {
  return !validateProfile(p).some((x) => x.fatal);
}

/**
 * Привести режимы каналов в согласие со списками языков.
 *
 * Пин на язык, которого больше нет в списке, — состояние, из которого
 * приложение не стартует. Раз списки правят в одном месте, а режимы
 * перебирают в другом, чинить это должен сам профиль, а не мастер.
 */
export function normalizeModes(p: MeetingProfile): MeetingProfile {
  const fix = (mode: LangMode, langs: Lang[]): LangMode => {
    if (!langs.length) return mode;
    if (mode.kind === 'auto') return langs.length >= 2 ? mode : { kind: 'pin', current: langs[0] };
    return langs.includes(mode.current) ? mode : { kind: 'pin', current: langs[0] };
  };
  return {
    ...p,
    presenterMode: fix(p.presenterMode, p.presenterLangs),
    audienceMode: fix(p.audienceMode, p.audienceLangs),
  };
}

/** Языковые пары для перевода — вычисляются из профиля, а не перечисляются руками. */
export function requiredPairs(p: MeetingProfile): { from: Lang; to: Lang }[] {
  const sources = new Set<Lang>([...p.presenterLangs, ...p.audienceLangs]);
  const pairs: { from: Lang; to: Lang }[] = [];
  for (const from of sources) {
    for (const to of transcriptLangs(p)) {
      if (from !== to) pairs.push({ from, to });
    }
  }
  return pairs;
}

/** Языки, в которые надо перевести реплику: стенограммы минус её собственный. */
export function targetsFor(p: MeetingProfile, origLang: Lang): Lang[] {
  return transcriptLangs(p).filter((l) => l !== origLang);
}

/**
 * Порядок перебора для кнопки канала: сначала языки канала, потом AUTO.
 *
 * AUTO появляется только при двух и более кандидатах — на одном языке
 * определять нечего, а стоит это дороже всего (§4). Порядок именно такой,
 * чтобы соседние нажатия давали соседние языки, а не прыгали через AUTO.
 */
export function modeCycle(langs: Lang[]): LangMode[] {
  const out: LangMode[] = langs.map((l) => ({ kind: 'pin', current: l }));
  if (langs.length >= 2) out.push({ kind: 'auto' });
  return out;
}

export function nextMode(langs: Lang[], m: LangMode): LangMode {
  const cycle = modeCycle(langs);
  const i = cycle.findIndex((x) => sameMode(x, m));
  return cycle[(i + 1) % cycle.length] ?? m;
}

export function sameMode(a: LangMode, b: LangMode): boolean {
  return a.kind === 'auto' ? b.kind === 'auto' : b.kind === 'pin' && a.current === b.current;
}

export function modeLabel(m: LangMode): string {
  return m.kind === 'auto' ? 'AUTO' : m.current.toUpperCase();
}
