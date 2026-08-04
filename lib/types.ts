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

/**
 * Настройки языков встречи. Здесь ТОЛЬКО то, что человек выбрал сам:
 * на каких языках говорит он и на каких может говорить зал.
 *
 * Язык субтитров и языки стенограмм отсюда выводятся (см. profile.ts) и
 * полем не хранятся: спрашивать их отдельно значит спрашивать одно и то
 * же дважды, а потом следить, чтобы ответы не разъехались.
 */
export type MeetingProfile = {
  presenterLangs: Lang[];
  presenterMode: LangMode;
  audienceLangs: Lang[];
  audienceMode: LangMode;
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

export type ShapeKind = 'rect' | 'ellipse' | 'arrow' | 'ink';

/** Координаты нормализованы к области слайда (0..1): окно меняет размер,
 *  Teams масштабирует, компоновка reserve/overlay двигает слайд. */
export type Shape = {
  id: string;
  kind: ShapeKind;
  /** Габариты. У росчерка — рамка по точкам: по ней он двигается и ищется. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  /**
   * Точки росчерка, только для kind:'ink'. Прорежены при вводе: писать
   * каждый отсчёт указателя значит хранить сотни точек на штрих и гонять
   * их в localStorage при каждом движении мыши.
   */
  points?: { x: number; y: number }[];
};

export type Annotations = Record<number, Shape[]>;

// --- Состояние сессии -----------------------------------------------------

/**
 * Куда девать субтитры относительно слайда.
 *   reserve — полоса внизу, слайд ужимается в остаток (по умолчанию);
 *   overlay — полоса поверх слайда;
 *   side    — колонка справа. Осмысленна только когда слайд уже окна:
 *             4:3 внутри 16:9 оставляет ровно четверть ширины пустой,
 *             и это место всё равно внутри расшаренного окна.
 */
export type CaptionLayout = 'reserve' | 'overlay' | 'side';

export type Mode = 'presenting' | 'qa' | 'both';

export type ChannelStatus = 'idle' | 'connecting' | 'listening' | 'reconnecting' | 'stopped' | 'error';

export type CaptionSettings = {
  layout: CaptionLayout;
  fontSize: number;
  bandHeight: number;
  color: string;
  background: string;
  /** Гасит только реплики зала, оставляя ведущего (§9). */
  showAudience: boolean;
};

export const DEFAULT_CAPTIONS: CaptionSettings = {
  layout: 'reserve',
  fontSize: 40,
  bandHeight: 22,
  color: '#ffffff',
  background: 'rgb(0 0 0 / 0.62)',
  showAudience: true,
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
  /**
   * История субтитров для боковой колонки — ТОЛЬКО на captionLang.
   * Приватный лог сюда не попадает никогда: ни оригиналов, ни второго
   * языка, ни правок. Это окно расшарено.
   */
  captionHistory: { id: string; text: string; speaker: Speaker }[];
};

/** Состояние окна показа до первого снимка от Control. Отдельная функция,
 *  а не константа: объект уезжает в setState и не должен быть общим. */
export function emptyPresentationState(): PresentationState {
  return {
    slideIndex: 0,
    slideCount: 0,
    captions: { ...DEFAULT_CAPTIONS },
    shapes: [],
    shapeKind: 'rect',
    shapeColor: 'rgb(250 204 21 / 0.35)',
    status: 'idle',
    captionLine: null,
    captionHistory: [],
  };
}
