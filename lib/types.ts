// Базовые типы. Языки — всегда базовые коды без региона (ТЗ §3а):
// аудитория смешанная, различать pt-PT и pt-BR смысла нет, а отображение
// в конкретный код для конкретного API — деталь адаптера.

export type Lang = 'en' | 'pt' | 'ru';

export const ALL_LANGS: Lang[] = ['en', 'pt', 'ru'];

export const LANG_NAMES: Record<Lang, string> = {
  en: 'English',
  pt: 'Português',
  ru: 'Русский',
};

/** Как определяется язык на канале. Выбор пользователя, не разработчика. */
export type LangMode =
  | { kind: 'auto' }
  | { kind: 'pin'; current: Lang };

export type MeetingProfile = {
  presenterLangs: Lang[];
  presenterMode: LangMode;
  audienceLangs: Lang[];
  audienceMode: LangMode;
  /** Язык полосы субтитров — язык, который понимает зал. */
  captionLang: Lang;
  /** Ровно два языка стенограмм. Первый — язык ведущего, на нём фокус лога. */
  transcriptLangs: [Lang, Lang];
};

export type Speaker = 'presenter' | 'audience';

/** Одна реплика, как её отдаёт провайдер. */
export type Utterance = {
  id: string;
  origLang: Lang;
  origText: string;
  /** Версии для стенограмм. Ключ, равный origLang, дублирует origText. */
  texts: Partial<Record<Lang, string>>;
  offsetMs: number;
  durationMs?: number;
  confidence?: number;
};

/** Запись лога. Хранит оригинал всегда, даже если он не показан ни в одной колонке. */
export type Entry = {
  id: string;
  ts: number;
  slideIndex: number;
  speaker: Speaker;
  origLang: Lang;
  origText: string;
  texts: Partial<Record<Lang, string>>;
  isFinal: boolean;
  flagged?: boolean;
  /** Правил ли человек руками — такие записи не перезаписываются провайдером. */
  edited?: boolean;
};

// --- Разметка поверх слайда (§6а) -----------------------------------------

export type ShapeKind = 'rect' | 'ellipse' | 'arrow';

/** Координаты нормализованы к области слайда (0..1): окно меняет размер,
 *  Teams масштабирует, компоновка reserve/overlay двигает слайд. */
export type Shape = {
  id: string;
  kind: ShapeKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
};

export type Annotations = Record<number, Shape[]>;

// --- Состояние сессии -----------------------------------------------------

export type CaptionLayout = 'reserve' | 'overlay';

export type Mode = 'presenting' | 'qa' | 'both';

export type ChannelStatus = 'idle' | 'connecting' | 'listening' | 'reconnecting' | 'stopped' | 'error';

export type CaptionSettings = {
  layout: CaptionLayout;
  fontSize: number;
  bandHeight: number;
  color: string;
  background: string;
  visible: boolean;
  /** Отдельно от visible: гасит только реплики зала, оставляя ведущего (§9). */
  showAudience: boolean;
};

/** То, что рисует окно Presentation. Больше оно ничего не знает. */
export type PresentationState = {
  slideIndex: number;
  slideCount: number;
  captions: CaptionSettings;
  shapes: Shape[];
  shapeKind: ShapeKind;
  shapeColor: string;
  status: ChannelStatus;
  /** Текущая строка субтитров, уже на captionLang. */
  captionLine: { text: string; final: boolean; speaker: Speaker } | null;
};
