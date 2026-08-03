import type { Lang, LangMode, MeetingProfile } from './types';

// Профиль встречи — ЕДИНСТВЕННОЕ место, где заданы языки (ТЗ §3а).
// Нигде больше в коде не должно быть литералов 'en' / 'pt' / 'ru'
// в смысле «язык ведущего» или «язык субтитров».

/**
 * С чего начинает новый пользователь. Готовых профилей на выбор больше нет:
 * их было три, отличались они парой полей, а разобраться в различиях было
 * дольше, чем просто выставить языки — что всё равно приходилось делать.
 *
 * Микрофон в пине, зал в авто — конфигурация из §4: своя речь получает
 * секундную задержку и не расходует лимит, а язык вопроса заранее неизвестен.
 */
export const DEFAULT_PROFILE: MeetingProfile = {
  presenterLangs: ['en'],
  presenterMode: { kind: 'pin', current: 'en' },
  audienceLangs: ['pt', 'en'],
  audienceMode: { kind: 'auto' },
  captionLang: 'pt',
  transcriptLangs: ['en', 'pt'],
};

/**
 * Проблема профиля. Текст НЕ хранится здесь: это слой данных, а слова
 * живут в словаре интерфейса и зависят от языка кнопок. Наружу отдаётся
 * ключ, компонент его переводит.
 */
export type ProfileProblem = { field: string; key: ProblemKey; fatal: boolean };

export type ProblemKey =
  | 'needPresenterLang'
  | 'needAudienceLang'
  | 'captionNotInTranscripts'
  | 'transcriptsSame'
  | 'autoWithOneLang'
  | 'pinnedNotInList'
  | 'autoOnMicIsExpensive';

export function validateProfile(p: MeetingProfile): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const add = (field: string, key: ProblemKey, fatal: boolean) => out.push({ field, key, fatal });

  if (p.presenterLangs.length === 0) add('presenterLangs', 'needPresenterLang', true);
  if (p.audienceLangs.length === 0) add('audienceLangs', 'needAudienceLang', true);
  if (!p.transcriptLangs.includes(p.captionLang)) add('captionLang', 'captionNotInTranscripts', true);
  if (p.transcriptLangs[0] === p.transcriptLangs[1]) add('transcriptLangs', 'transcriptsSame', true);

  // auto на одном кандидате — бессмысленная трата лимита: определять нечего.
  if (p.presenterMode.kind === 'auto' && p.presenterLangs.length < 2) add('presenterMode', 'autoWithOneLang', false);
  if (p.audienceMode.kind === 'auto' && p.audienceLangs.length < 2) add('audienceMode', 'autoWithOneLang', false);

  if (p.presenterMode.kind === 'pin' && !p.presenterLangs.includes(p.presenterMode.current))
    add('presenterMode', 'pinnedNotInList', true);
  if (p.audienceMode.kind === 'pin' && !p.audienceLangs.includes(p.audienceMode.current))
    add('audienceMode', 'pinnedNotInList', true);

  // Микрофон в auto — самый дорогой режим: ведущий говорит почти непрерывно.
  if (p.presenterMode.kind === 'auto') add('presenterMode', 'autoOnMicIsExpensive', false);

  return out;
}

export function profileIsUsable(p: MeetingProfile): boolean {
  return !validateProfile(p).some((x) => x.fatal);
}

/** Языковые пары для перевода — вычисляются из профиля, а не перечисляются руками. */
export function requiredPairs(p: MeetingProfile): { from: Lang; to: Lang }[] {
  const sources = new Set<Lang>([...p.presenterLangs, ...p.audienceLangs]);
  const pairs: { from: Lang; to: Lang }[] = [];
  for (const from of sources) {
    for (const to of p.transcriptLangs) {
      if (from !== to) pairs.push({ from, to });
    }
  }
  return pairs;
}

/** Нужен ли вообще ключ Gemini при этом профиле. */
export function needsApiKey(p: MeetingProfile): boolean {
  return p.presenterMode.kind === 'auto' || p.audienceMode.kind === 'auto';
}

/** Языки, в которые надо перевести реплику: стенограммы минус её собственный. */
export function targetsFor(p: MeetingProfile, origLang: Lang): Lang[] {
  return p.transcriptLangs.filter((l) => l !== origLang);
}

export function cycleLang(langs: Lang[], current: Lang): Lang {
  const i = langs.indexOf(current);
  return langs[(i + 1) % langs.length] ?? current;
}

export function modeLabel(m: LangMode): string {
  return m.kind === 'auto' ? 'AUTO' : m.current.toUpperCase();
}
