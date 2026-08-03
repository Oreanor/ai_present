import type { Lang, LangMode, MeetingProfile } from './types';

// Профиль встречи — ЕДИНСТВЕННОЕ место, где заданы языки (ТЗ §3а).
// Нигде больше в коде не должно быть литералов 'en' / 'pt' / 'ru'
// в смысле «язык ведущего» или «язык субтитров».

export const PRESETS: { id: string; label: string; hint: string; profile: MeetingProfile }[] = [
  {
    id: 'ru-en-to-pt',
    label: 'I speak English/Russian → Portuguese audience',
    hint: 'Microphone pinned for speed, audience auto-detected',
    profile: {
      presenterLangs: ['en', 'ru'],
      presenterMode: { kind: 'pin', current: 'en' },
      audienceLangs: ['pt', 'en'],
      audienceMode: { kind: 'auto' },
      captionLang: 'pt',
      transcriptLangs: ['en', 'pt'],
    },
  },
  {
    id: 'pt-to-en',
    label: 'I speak Portuguese → English audience',
    hint: 'No API key needed at all — everything runs on device',
    profile: {
      presenterLangs: ['pt', 'en'],
      presenterMode: { kind: 'pin', current: 'pt' },
      audienceLangs: ['en'],
      audienceMode: { kind: 'pin', current: 'en' },
      captionLang: 'en',
      transcriptLangs: ['pt', 'en'],
    },
  },
  {
    id: 'en-to-pt',
    label: 'I speak English → Portuguese audience',
    hint: 'Simplest setup, no API key needed',
    profile: {
      presenterLangs: ['en'],
      presenterMode: { kind: 'pin', current: 'en' },
      audienceLangs: ['pt', 'en'],
      audienceMode: { kind: 'auto' },
      captionLang: 'pt',
      transcriptLangs: ['en', 'pt'],
    },
  },
];

export const DEFAULT_PROFILE: MeetingProfile = PRESETS[0].profile;

export type ProfileProblem = { field: string; message: string; fatal: boolean };

export function validateProfile(p: MeetingProfile): ProfileProblem[] {
  const out: ProfileProblem[] = [];

  if (p.presenterLangs.length === 0)
    out.push({ field: 'presenterLangs', message: 'Pick at least one language you speak.', fatal: true });
  if (p.audienceLangs.length === 0)
    out.push({ field: 'audienceLangs', message: 'Pick at least one language the audience speaks.', fatal: true });

  if (!p.transcriptLangs.includes(p.captionLang))
    out.push({
      field: 'captionLang',
      message: 'Caption language must be one of the two transcript languages.',
      fatal: true,
    });

  if (p.transcriptLangs[0] === p.transcriptLangs[1])
    out.push({ field: 'transcriptLangs', message: 'The two transcripts must be in different languages.', fatal: true });

  // auto на одном кандидате — бессмысленная трата лимита: определять нечего.
  if (p.presenterMode.kind === 'auto' && p.presenterLangs.length < 2)
    out.push({
      field: 'presenterMode',
      message: 'Only one language to detect — pin it instead. Faster, and costs nothing.',
      fatal: false,
    });
  if (p.audienceMode.kind === 'auto' && p.audienceLangs.length < 2)
    out.push({
      field: 'audienceMode',
      message: 'Only one language to detect — pin it instead. Faster, and costs nothing.',
      fatal: false,
    });

  if (p.presenterMode.kind === 'pin' && !p.presenterLangs.includes(p.presenterMode.current))
    out.push({ field: 'presenterMode', message: 'Pinned language is not in your language list.', fatal: true });
  if (p.audienceMode.kind === 'pin' && !p.audienceLangs.includes(p.audienceMode.current))
    out.push({ field: 'audienceMode', message: 'Pinned language is not in the audience list.', fatal: true });

  // Микрофон в auto — самый дорогой режим: ведущий говорит почти непрерывно.
  if (p.presenterMode.kind === 'auto')
    out.push({
      field: 'presenterMode',
      message:
        'Auto-detect on the microphone means ~600 Gemini requests per 2-hour talk, ' +
        'which likely exceeds the free daily quota. Captions also get ~20x slower. ' +
        'Pin the language unless you really switch mid-sentence.',
      fatal: false,
    });

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
