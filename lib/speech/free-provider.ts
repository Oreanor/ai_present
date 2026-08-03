import type { Lang, Utterance } from '../types';
import { translate } from './translator';
import { uid, type Capabilities, type SpeechProvider, type StartOptions } from './types';

// Основной провайдер микрофонного канала (§4). Разведка показала 95–147 мс
// от конца фразы — в 20–30 раз быстрее чанкового Gemini, без ключа и лимитов.

// Web Speech не типизирован в lib.dom, объявляем минимум нужного.
type SRAlt = { transcript: string; confidence: number };
type SRResult = { isFinal: boolean; 0: SRAlt; length: number };
type SREvent = { results: { length: number; [i: number]: SRResult }; resultIndex: number };
type SRErrorEvent = { error: string; message?: string };
type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechend: (() => void) | null;
};

function SRClass(): (new () => SR) | null {
  const g = globalThis as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

export function webSpeechSupported(): boolean {
  return SRClass() !== null;
}

/** Web Speech хочет региональный код; наружу мы работаем базовыми (§3а). */
const BCP47: Record<Lang, string> = { en: 'en-US', ru: 'ru-RU', pt: 'pt-BR' };

/** Склейка ВСЕХ элементов results. Чтение только последнего даёт мигающий
 *  текст с выпадающими словами — ровно то дрожание, что запрещает §9. */
function joinResults(e: SREvent): { text: string; isFinal: boolean; confidence: number } {
  let text = '';
  let isFinal = false;
  let confidence = 0;
  for (let i = 0; i < e.results.length; i++) {
    const r = e.results[i];
    text += r[0].transcript;
    if (r.isFinal) {
      isFinal = true;
      confidence = Math.max(confidence, r[0].confidence ?? 0);
    }
  }
  return { text: text.trim(), isFinal, confidence };
}

/**
 * Одна «дорожка» распознавания. Web Speech рвётся примерно раз в минуту,
 * поэтому дорожек две и они перекрываются: пока одна перезапускается,
 * вторая слушает. Наивный перезапуск по onend теряет слова на стыке.
 */
class Track {
  private rec: SR | null = null;
  private stopped = false;
  private restarts = 0;

  constructor(
    private lang: string,
    private onEvent: (e: SREvent) => void,
    private onFatal: (e: Error) => void,
    private onRestart: () => void,
  ) {}

  start(): void {
    const Ctor = SRClass();
    if (!Ctor) {
      this.onFatal(new Error('Web Speech API is not available.'));
      return;
    }
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => this.onEvent(e);
    rec.onerror = (e) => {
      // not-allowed — политика Chrome или отказ в разрешении: чинить нечем.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.stopped = true;
        this.onFatal(new Error(`Microphone access denied (${e.error}).`));
      }
      // no-speech / aborted / network — штатная жизнь, перезапустимся в onend.
    };
    rec.onend = () => {
      if (this.stopped) return;
      this.restarts += 1;
      this.onRestart();
      // Небольшая пауза, иначе Chrome иногда отдаёт InvalidStateError.
      setTimeout(() => {
        if (!this.stopped) this.startSafely(rec);
      }, 120);
    };

    this.rec = rec;
    this.startSafely(rec);
  }

  private startSafely(rec: SR): void {
    try {
      rec.start();
    } catch {
      /* уже запущен — Chrome бросает InvalidStateError, это безвредно */
    }
  }

  setLang(lang: string): void {
    this.lang = lang;
    if (this.rec) {
      this.rec.abort(); // onend перезапустит уже с новым языком
    }
  }

  stop(): void {
    this.stopped = true;
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    this.rec = null;
  }

  get restartCount(): number {
    return this.restarts;
  }
}

export class FreeProvider implements SpeechProvider {
  readonly id = 'free';
  readonly label = 'On-device (Web Speech + Translator)';
  readonly capabilities: Capabilities = {
    inlineTranslation: false, // перевод отдельным шагом, приезжает позже
    partials: true,
    languageDetection: false, // Web Speech принимает ровно один язык
    concurrentSessions: 4,
    usesQuota: false,
  };

  private tracks: Track[] = [];
  private opts: StartOptions | null = null;
  private lang: Lang = 'en';
  private t0 = 0;
  /** Текст последней отданной реплики — чтобы не слать одно и то же дважды. */
  private lastSent = '';
  private currentId = uid('f');

  async start(opts: StartOptions): Promise<void> {
    this.opts = opts;
    this.lang = opts.sourceLang[0] ?? 'en';
    this.t0 = performance.now();
    opts.onStatus('connecting');

    if (!webSpeechSupported()) {
      opts.onError(new Error('Web Speech API is not available in this browser.'));
      opts.onStatus('error');
      return;
    }

    // Разрешение спрашиваем явно: иначе первая ошибка прилетит уже из
    // распознавателя, где её труднее объяснить пользователю.
    if (opts.source.kind === 'mic') {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: opts.source.deviceId ? { exact: opts.source.deviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        s.getTracks().forEach((t) => t.stop());
      } catch (e) {
        opts.onError(e instanceof Error ? e : new Error(String(e)));
        opts.onStatus('error');
        return;
      }
    }

    const handle = (e: SREvent) => this.handle(e);
    const fatal = (err: Error) => {
      opts.onError(err);
      opts.onStatus('error');
    };
    const restart = () => opts.onStatus('listening');

    this.tracks = [
      new Track(BCP47[this.lang], handle, fatal, restart),
      new Track(BCP47[this.lang], handle, fatal, restart),
    ];
    this.tracks[0].start();
    // Вторую дорожку смещаем во времени, чтобы их перезапуски не совпали.
    setTimeout(() => this.tracks[1]?.start(), 2500);
    opts.onStatus('listening');
  }

  setLanguage(lang: Lang): void {
    if (!this.opts || lang === this.lang) return;
    this.lang = lang;
    this.lastSent = '';
    this.currentId = uid('f');
    for (const t of this.tracks) t.setLang(BCP47[lang]);
  }

  private handle(e: SREvent): void {
    const opts = this.opts;
    if (!opts) return;
    const { text, isFinal, confidence } = joinResults(e);
    if (!text) return;

    // Две дорожки слышат одно и то же — дубликаты гасим по тексту.
    if (isFinal && text === this.lastSent) return;

    const u: Utterance = {
      id: this.currentId,
      origLang: this.lang,
      origText: text,
      texts: { [this.lang]: text },
      offsetMs: Math.round(performance.now() - this.t0),
      confidence,
    };

    if (!isFinal) {
      opts.onPartial(u);
      return;
    }

    this.lastSent = text;
    const id = this.currentId;
    this.currentId = uid('f'); // следующая реплика — новая запись
    opts.onFinal(u);

    // Переводы догоняют по одному языку. Полоса субтитров ждёт свой —
    // показывать зрителям оригинал нельзя (§9).
    for (const to of opts.targetLangs) {
      if (to === this.lang) continue;
      translate(text, this.lang, to)
        .then((out) => opts.onTranslation(id, to, out))
        .catch((err) => opts.onError(err instanceof Error ? err : new Error(String(err))));
    }
  }

  async stop(): Promise<void> {
    for (const t of this.tracks) t.stop();
    this.tracks = [];
    this.opts?.onStatus('stopped');
    this.opts = null;
  }
}
