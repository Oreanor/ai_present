import type { Lang, Utterance } from '../types';
import { WEB_SPEECH } from '../constants';
import { getTranslator, translate } from './translator';
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

  private rec: SR | null = null;
  private opts: StartOptions | null = null;
  private lang: Lang = 'en';
  private t0 = 0;
  private stopped = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Сколько элементов results уже отдано наружу. Web Speech копит их
   * за сессию и присылает весь список каждый раз; без этого счётчика
   * одна и та же фраза уезжает в лог по десять раз.
   */
  private emitted = 0;
  /** Об ошибке перевода сообщаем один раз за сессию, а не на каждой фразе. */
  private translationErrorShown = false;

  async start(opts: StartOptions): Promise<void> {
    this.opts = opts;
    this.lang = opts.sourceLang[0] ?? 'en';
    this.t0 = performance.now();
    this.stopped = false;
    this.emitted = 0;
    this.translationErrorShown = false;
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

    // Прогреваем переводчики, пока ещё жив пользовательский жест от кнопки
    // «Presenting». Скачивание языкового пакета без свежего жеста падает
    // с NotAllowedError, а из колбэка распознавания жеста уже нет.
    void this.warmTranslators();

    this.launch();
  }

  private async warmTranslators(): Promise<void> {
    const opts = this.opts;
    if (!opts) return;
    for (const to of opts.targetLangs) {
      if (to === this.lang) continue;
      try {
        await getTranslator(this.lang, to);
      } catch {
        opts.onError(
          new Error(
            `Translation pack ${this.lang}→${to} is not ready. Open ⋯ → Languages and setup and press Download next to it.`,
          ),
        );
      }
    }
  }

  /**
   * ОДИН распознаватель. Раньше их было два «внахлёст», чтобы не терять
   * слова на перезапуске, — но Chrome не держит два SpeechRecognition
   * одновременно: второй прерывает первый, тот перезапускается и прерывает
   * второй. Распознавание умирало после первых слов, не доходя до финала,
   * а без финала не было ни перевода, ни записи в лог.
   */
  private launch(): void {
    const opts = this.opts;
    const Ctor = SRClass();
    if (!opts || !Ctor || this.stopped) return;

    const rec = new Ctor();
    rec.lang = BCP47[this.lang];
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => this.handle(e);

    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.stopped = true;
        opts.onError(new Error(`Microphone access denied (${e.error}). Check Chrome site permissions.`));
        opts.onStatus('error');
        return;
      }
      if (e.error === 'network') {
        opts.onError(new Error('Speech recognition lost the network. Retrying.'));
        opts.onStatus('reconnecting');
      }
      // no-speech и aborted — штатная жизнь, перезапустимся в onend
    };

    rec.onend = () => {
      if (this.stopped) return;
      // Список results начинается заново, счётчик отданных — тоже.
      this.emitted = 0;
      opts.onStatus('reconnecting');
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.launch();
        opts.onStatus('listening');
      }, WEB_SPEECH.RESTART_MS);
    };

    this.rec = rec;
    try {
      rec.start();
      opts.onStatus('listening');
    } catch {
      // InvalidStateError, если предыдущий ещё не отпустил микрофон.
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.launch();
      }, WEB_SPEECH.BUSY_RETRY_MS);
    }
  }

  setLanguage(lang: Lang): void {
    if (!this.opts || lang === this.lang) return;
    this.lang = lang;
    this.emitted = 0;
    void this.warmTranslators();
    // abort → onend → launch уже с новым языком
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
  }

  /**
   * Разбор события. Финальными считаются только НОВЫЕ элементы results,
   * по одному. Прежняя версия склеивала весь список и объявляла его
   * финальным, если финален любой элемент, — после первой же фразы флаг
   * залипал и каждый промежуточный результат уезжал в лог как готовый.
   */
  private handle(e: SREvent): void {
    const opts = this.opts;
    if (!opts) return;

    for (let i = this.emitted; i < e.results.length; i++) {
      const res = e.results[i];
      if (!res.isFinal) break; // дальше только промежуточные

      const text = res[0].transcript.trim();
      this.emitted = i + 1;
      if (!text) continue;

      const id = uid('f');
      opts.onFinal({
        id,
        origLang: this.lang,
        origText: text,
        texts: { [this.lang]: text },
        offsetMs: Math.round(performance.now() - this.t0),
        confidence: res[0].confidence,
      } satisfies Utterance);

      this.translateInto(id, text, opts);
    }

    // Всё, что после последнего финала, — текущая незаконченная фраза.
    let interim = '';
    for (let i = this.emitted; i < e.results.length; i++) {
      if (!e.results[i].isFinal) interim += e.results[i][0].transcript;
    }
    interim = interim.trim();
    if (interim) {
      opts.onPartial({
        id: 'interim',
        origLang: this.lang,
        origText: interim,
        texts: { [this.lang]: interim },
        offsetMs: Math.round(performance.now() - this.t0),
      });
    }
  }

  /** Переводы догоняют по одному языку. Полоса субтитров ждёт свой —
   *  показывать зрителям оригинал нельзя (§9). */
  private translateInto(id: string, text: string, opts: StartOptions): void {
    for (const to of opts.targetLangs) {
      if (to === this.lang) {
        opts.onTranslation(id, to, text);
        continue;
      }
      translate(text, this.lang, to)
        .then((out) => opts.onTranslation(id, to, out))
        .catch((err) => {
          if (this.translationErrorShown) return;
          this.translationErrorShown = true;
          opts.onError(
            new Error(
              `Cannot translate ${this.lang}→${to}: ${err instanceof Error ? err.message : String(err)}. ` +
                'Open ⋯ → Languages and setup and download the language pack.',
            ),
          );
        });
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    this.rec = null;
    this.opts?.onStatus('stopped');
    this.opts = null;
  }
}
