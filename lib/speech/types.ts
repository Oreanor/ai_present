import type { Lang, Utterance } from '../types';

// Абстракция провайдера (ТЗ §3). Три отличия от наивного варианта, без
// которых смена провайдера невозможна физически:
//   1. источник — дескриптор, а не MediaStream: Web Speech не принимает поток;
//   2. переводы приезжают позже текста и по одному языку;
//   3. языков больше двух, поэтому texts — словарь.

export type AudioSource =
  | { kind: 'mic'; deviceId?: string }
  | { kind: 'stream'; stream: MediaStream };

export type ProviderStatus = 'connecting' | 'listening' | 'reconnecting' | 'stopped' | 'error';

export type Capabilities = {
  /** Перевод приходит вместе с текстом. */
  inlineTranslation: boolean;
  partials: boolean;
  /** Умеет ли выбирать из нескольких sourceLang. */
  languageDetection: boolean;
  /** Сколько распознавателей тянет тариф. */
  concurrentSessions: number;
  /** Расходует ли лимит запросов — от этого зависят предупреждения в UI. */
  usesQuota: boolean;
};

export type StartOptions = {
  source: AudioSource;
  /** Один элемент — фиксация, несколько — кандидаты. Берётся из профиля. */
  sourceLang: Lang[];
  /** Куда переводить. Язык, совпавший с origLang, не переводится. */
  targetLangs: Lang[];
  /** Словарь терминов для смещения распознавания (§6б). */
  phrases?: string[];
  onPartial(u: Utterance): void;
  onFinal(u: Utterance): void;
  /** Догоняющий перевод для уже отданной реплики, по одному языку. */
  onTranslation(id: string, lang: Lang, text: string): void;
  onError(e: Error): void;
  onStatus(s: ProviderStatus): void;
};

export interface SpeechProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: Capabilities;
  start(opts: StartOptions): Promise<void>;
  stop(): Promise<void>;
  /** Сменить язык на живой сессии, не разрывая её (клавиша L). */
  setLanguage?(lang: Lang): void;
}

let counter = 0;
export function uid(prefix = 'u'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}
