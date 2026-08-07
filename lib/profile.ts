import { ALL_LANGS, type Lang, type LangMode, type MeetingProfile, type Speaker } from './types';

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

/** Язык, на котором ведущий сейчас говорит. В auto — первый из списка. */
export function presenterLangOf(pr: MeetingProfile): Lang {
  return pr.presenterMode.kind === 'pin' ? pr.presenterMode.current : (pr.presenterLangs[0] ?? ALL_LANGS[0]);
}

/**
 * На каком языке субтитровать реплику — по порядку предпочтения.
 *
 * Субтитр всегда обращён к ДРУГОЙ стороне: то, что сказал ведущий, зал
 * читает на своём языке, а вопрос из зала ведущий читает на своём. Это не
 * то же самое, что язык чтения ленты: ленту листают потом и в любую
 * сторону, а субтитр нужен тому, кто прямо сейчас не понял сказанного.
 *
 * Список, а не один язык: приколотый язык микрофона может не входить в
 * стенограммы, и тогда перевода на него просто нет — падаем на язык
 * стенограммы, а не показываем пустую полосу.
 */
export function subtitlePrefs(pr: MeetingProfile, speaker: Speaker, origLang?: Lang): Lang[] {
  if (origLang !== undefined && keepsOriginal(pr, speaker, origLang)) {
    return [...new Set([origLang, ...transcriptLangs(pr)])];
  }
  const want = speaker === 'presenter' ? captionLangOf(pr) : presenterLangOf(pr);
  return [...new Set([want, ...transcriptLangs(pr)])];
}

/**
 * Реплика зала на языке, которым ведущий владеет, идёт в полосу КАК СКАЗАНА.
 *
 * Переводить её незачем и вредно. Перевод приезжает позже — а вопрос из
 * зала нужен ведущему в ту секунду, когда он задан. И он подменяет точную
 * формулировку пересказом: ответить на вопрос, который тебе перевели с
 * языка, который ты и так понимаешь, — значит отвечать не на него.
 *
 * Понимание считаем по presenterLangs, а не по приколотому языку: ведущий
 * приколол один язык, чтобы на нём ГОВОРИТЬ, но читает он их все.
 */
export function keepsOriginal(pr: MeetingProfile, speaker: Speaker, origLang: Lang): boolean {
  return speaker === 'audience' && pr.presenterLangs.includes(origLang);
}

/** Первый доступный перевод из списка предпочтений. */
export function pickText(texts: Partial<Record<Lang, string>>, prefs: Lang[]): string | undefined {
  for (const l of prefs) if (texts[l]) return texts[l];
  return undefined;
}

/**
 * Что показать в полосе для этой реплики.
 *
 * Отдельно от pickText из-за одного случая: язык оригинала может не входить
 * в стенограммы (ведущий владеет тремя языками, а ведутся две), и тогда в
 * texts его просто нет. Голый pickText молча упал бы на перевод — ровно
 * там, где оригинал и требовался.
 */
export function subtitleText(
  pr: MeetingProfile,
  e: { speaker: Speaker; origLang: Lang; origText: string; texts: Partial<Record<Lang, string>> },
): string | undefined {
  const prefs = subtitlePrefs(pr, e.speaker, e.origLang);
  if (prefs[0] === e.origLang) return e.texts[e.origLang] ?? e.origText;
  return pickText(e.texts, prefs);
}

/**
 * Проблема профиля. Текст НЕ хранится здесь: это слой данных, а слова
 * живут в словаре интерфейса и зависят от языка кнопок. Наружу отдаётся
 * ключ, компонент его переводит.
 */
export type ProfileProblem = { field: string; key: ProblemKey; fatal: boolean };

export type ProblemKey = 'needPresenterLang' | 'needAudienceLang' | 'autoWithOneLang';

export function validateProfile(p: MeetingProfile): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const add = (field: string, key: ProblemKey, fatal: boolean) => out.push({ field, key, fatal });

  if (p.presenterLangs.length === 0) add('presenterLangs', 'needPresenterLang', true);
  if (p.audienceLangs.length === 0) add('audienceLangs', 'needAudienceLang', true);

  // auto на одном кандидате — бессмысленная трата лимита: определять нечего.
  if (p.presenterMode.kind === 'auto' && p.presenterLangs.length < 2) add('presenterMode', 'autoWithOneLang', false);
  if (p.audienceMode.kind === 'auto' && p.audienceLangs.length < 2) add('audienceMode', 'autoWithOneLang', false);

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
 *
 * Без ключа Gemini AUTO не появляется вовсе: определять язык умеет только
 * он. Предлагать выбор, который гарантированно кончится красной лампочкой
 * и сообщением об ошибке, — хуже, чем не предлагать его совсем.
 */
export function modeCycle(langs: Lang[], allowAuto: boolean): LangMode[] {
  const out: LangMode[] = langs.map((l) => ({ kind: 'pin', current: l }));
  if (allowAuto && langs.length >= 2) out.push({ kind: 'auto' });
  return out;
}

export function nextMode(langs: Lang[], m: LangMode, allowAuto: boolean): LangMode {
  const cycle = modeCycle(langs, allowAuto);
  const i = cycle.findIndex((x) => sameMode(x, m));
  return cycle[(i + 1) % cycle.length] ?? m;
}

export function sameMode(a: LangMode, b: LangMode): boolean {
  return a.kind === 'auto' ? b.kind === 'auto' : b.kind === 'pin' && a.current === b.current;
}

export function modeLabel(m: LangMode): string {
  return m.kind === 'auto' ? 'AUTO' : m.current.toUpperCase();
}
