import type { Lang, Utterance } from '../types';
import { LANG_NAMES } from '../types';
import { loadApiKey } from '../storage';
import { blobToBase64, encodeWav, Vad } from './vad';
import { uid, type Capabilities, type SpeechProvider, type StartOptions } from './types';

// Чанковый провайдер (§4). Обслуживает обратный канал, где язык заранее
// неизвестен, и работает аварийным дублем микрофонного.
//
// Чанк = ОДНА РЕПЛИКА по границам VAD, отправка сразу по окончании речи.
// Не нарезка по таймеру: вопросы зала идут в субтитры, и задержка
// в 20–30 секунд сделала бы их бессмысленными (§9).

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/**
 * Ограничитель частоты. У бесплатного тарифа лимитов три, и первым
 * упирается НЕ суточный, а минутный: около 10–15 запросов в минуту.
 * Речь режется на реплики быстрее, поэтому без учёта RPM провайдер
 * выжигает минутный лимит за секунды и получает 429, который легко
 * принять за исчерпание дневной квоты.
 */
/** Цены Tier 1 за миллион токенов. */
const USD_PER_INPUT_TOKEN = 0.30 / 1_000_000;
const USD_PER_OUTPUT_TOKEN = 2.50 / 1_000_000;

/** Оценка до первого ответа: реплика 10–15 секунд это примерно
 *  500 входных токенов аудио плюс промпт и 150 выходных. */
export const COST_PER_REQUEST_USD = 0.0008;

export const quota = {
  used: 0,
  /** Запросов в минуту. Free tier ~10, платный Tier 1 — сотни. */
  rpm: 10,
  /** Запросов в сутки. Free tier ~250. */
  rpd: 250,
  /**
   * Жёсткий потолок, который ставит пользователь. Существует ровно затем,
   * чтобы залипший VAD или цикл переподключения не превратили тридцать
   * центов в тридцать евро, пока никто не смотрит. Бюджетные уведомления
   * Google приходят постфактум и ничего не останавливают.
   */
  cap: 400,
  /** Метки времени отправленных запросов за последнюю минуту. */
  recent: [] as number[],
  listeners: new Set<(n: number) => void>(),

  setLimits(rpm: number, rpd: number, cap?: number) {
    this.rpm = rpm;
    this.rpd = rpd;
    if (cap !== undefined) this.cap = cap;
  },

  /** Фактически израсходованные токены — Gemini возвращает их в каждом
   *  ответе, так что считаем не оценку, а реальную стоимость. */
  inTokens: 0,
  outTokens: 0,

  addUsage(inTok: number, outTok: number) {
    this.inTokens += inTok;
    this.outTokens += outTok;
    for (const l of this.listeners) l(this.used);
  },

  /**
   * Потрачено. Обновляется сразу по приходу ответа, без обращений
   * к биллингу — цифра должна быть перед глазами во время встречи,
   * а не в консоли Google на следующий день.
   *
   * До первого ответа считаем по оценке; дальше — по фактическим токенам.
   * Учитывает только расход этого приложения в этом браузере.
   */
  spentUsd(): number {
    if (this.inTokens === 0) return this.used * COST_PER_REQUEST_USD;
    return this.inTokens * USD_PER_INPUT_TOKEN + this.outTokens * USD_PER_OUTPUT_TOKEN;
  },

  /** Сколько ещё можно отправить прямо сейчас, не упираясь в минутный лимит. */
  slotsLeft(): number {
    const now = Date.now();
    this.recent = this.recent.filter((t) => now - t < 60_000);
    return Math.max(0, this.rpm - this.recent.length);
  },

  /** Через сколько миллисекунд освободится слот. */
  waitMs(): number {
    if (this.slotsLeft() > 0) return 0;
    return Math.max(0, 60_000 - (Date.now() - this.recent[0]) + 50);
  },

  take() {
    this.recent.push(Date.now());
    this.used += 1;
    for (const l of this.listeners) l(this.used);
  },

  /** Упёрлись либо в лимит тарифа, либо в собственный потолок — что раньше. */
  dayExhausted(): boolean {
    return this.used >= Math.min(this.rpd, this.cap);
  },

  capReached(): boolean {
    return this.used >= this.cap;
  },

  reset() {
    this.used = 0;
    this.recent = [];
    this.inTokens = 0;
    this.outTokens = 0;
    for (const l of this.listeners) l(0);
  },

  subscribe(fn: (n: number) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
};

/** Google кладёт рекомендованную паузу в тело ошибки. Уважать её дешевле,
 *  чем угадывать: слепые ретраи только усугубляют 429. */
function retryDelayMs(body: string): number | null {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
}

type GeminiJson = { lang: string; text: string } & Record<string, string>;

function buildPrompt(sourceLangs: Lang[], targetLangs: Lang[]): string {
  const names = sourceLangs.map((l) => `${LANG_NAMES[l]} (${l})`).join(', ');
  const fields = targetLangs.map((l) => `"${l}":"<translation>"`).join(', ');
  return (
    'You are a transcription and translation service inside a live presentation tool. ' +
    `The audio contains one spoken utterance in one of: ${names}. ` +
    'Detect which language it is, transcribe it verbatim without adding or omitting anything, ' +
    `then provide translations. Reply with JSON only, no prose, no markdown: ` +
    `{"lang":"<detected code>","text":"<verbatim transcript>",${fields}}. ` +
    'If a requested translation language equals the detected language, repeat the transcript there. ' +
    'If the audio contains no intelligible speech, reply {"lang":"","text":""}.'
  );
}

export class GeminiChunkProvider implements SpeechProvider {
  readonly id = 'gemini';
  readonly label = 'Gemini (auto language detection)';
  readonly capabilities: Capabilities = {
    inlineTranslation: true,
    partials: false, // фраза появляется целиком
    languageDetection: true, // единственный доступный движок, который это умеет
    concurrentSessions: 1,
    usesQuota: true,
  };

  private vad: Vad | null = null;
  private stream: MediaStream | null = null;
  private ownsStream = false;
  private opts: StartOptions | null = null;
  private t0 = 0;
  private pinned: Lang | null = null;
  private inflight = 0;
  private dayWarned = false;

  async start(opts: StartOptions): Promise<void> {
    this.opts = opts;
    this.t0 = performance.now();
    this.pinned = opts.sourceLang.length === 1 ? opts.sourceLang[0] : null;
    opts.onStatus('connecting');

    if (!loadApiKey()) {
      opts.onError(new Error('No Gemini API key. Add one in settings, or pin the language to use on-device mode.'));
      opts.onStatus('error');
      return;
    }

    try {
      if (opts.source.kind === 'stream') {
        this.stream = opts.source.stream;
      } else {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: opts.source.deviceId ? { exact: opts.source.deviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        this.ownsStream = true;
      }
    } catch (e) {
      opts.onError(e instanceof Error ? e : new Error(String(e)));
      opts.onStatus('error');
      return;
    }

    this.vad = new Vad({
      onUtterance: (pcm, sr, dur) => void this.send(pcm, sr, dur),
    });
    await this.vad.start(this.stream);
    opts.onStatus('listening');
  }

  setLanguage(lang: Lang): void {
    this.pinned = lang;
  }

  private async send(pcm: Float32Array, sampleRate: number, durationMs: number): Promise<void> {
    const opts = this.opts;
    if (!opts) return;

    if (quota.dayExhausted()) {
      if (!this.dayWarned) {
        this.dayWarned = true;
        opts.onError(
          new Error(
            quota.capReached()
              ? `Stopped at your own limit of ${quota.cap} requests (about $${quota.spentUsd().toFixed(2)}). ` +
                'Raise it in ⋯ → Languages and setup if you meant to keep going.'
              : 'Gemini quota for this key is used up. The meeting audio channel stops; your own speech keeps working.',
          ),
        );
      }
      return;
    }

    // Ждём свободный слот вместо того, чтобы выбрасывать реплику: лог
    // терпит задержку, а потерянный вопрос из зала не восстановить.
    // Ждём не дольше половины минуты — позже реплика всё равно неактуальна.
    const wait = quota.waitMs();
    if (wait > 0) {
      if (wait > 30_000 || this.inflight >= 2) return;
      await new Promise((r) => setTimeout(r, wait));
      if (!this.opts) return;
    }

    quota.take();
    this.inflight += 1;

    const id = uid('g');
    const offsetMs = Math.round(performance.now() - this.t0);
    const sources = this.pinned ? [this.pinned] : opts.sourceLang;

    try {
      const b64 = await blobToBase64(encodeWav(pcm, sampleRate));
      const body = {
        contents: [
          {
            parts: [
              { text: buildPrompt(sources, opts.targetLangs) },
              ...(opts.phrases?.length
                ? [{ text: `Proper nouns likely present: ${opts.phrases.slice(0, 120).join(', ')}.` }]
                : []),
              { inline_data: { mime_type: 'audio/wav', data: b64 } },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      };

      let res = await this.request(body);

      // 429 бывает двух разных видов, и путать их нельзя: минутный лимит
      // проходит сам через несколько секунд, суточный означает конец сессии.
      if (res.status === 429) {
        const text = await res.text();
        const perDay = /per day|PerDay|RPD/i.test(text);
        if (perDay) {
          quota.used = quota.rpd;
          throw new Error('Gemini daily quota is used up. Switch this channel to a pinned language, or upgrade the key.');
        }
        const delay = Math.min(retryDelayMs(text) ?? 4000, 20_000);
        opts.onStatus('reconnecting');
        await new Promise((r) => setTimeout(r, delay));
        if (!this.opts) return;
        res = await this.request(body);
        opts.onStatus('listening');
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          res.status === 429
            ? 'Gemini is rate limiting this key. Free keys allow about 10 requests a minute.'
            : `Gemini error ${res.status}: ${text.slice(0, 200)}`,
        );
      }

      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      quota.addUsage(json.usageMetadata?.promptTokenCount ?? 0, json.usageMetadata?.candidatesTokenCount ?? 0);
      const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      let parsed: GeminiJson | null = null;
      try {
        parsed = JSON.parse(raw) as GeminiJson;
      } catch {
        throw new Error('Gemini returned non-JSON output.');
      }

      const detected = (parsed.lang || sources[0]) as Lang;
      const text = (parsed.text ?? '').trim();
      if (!text) return; // тишина или неразборчиво — молча пропускаем

      const texts: Partial<Record<Lang, string>> = { [detected]: text };
      for (const to of opts.targetLangs) {
        const v = parsed[to];
        if (typeof v === 'string' && v.trim()) texts[to] = v.trim();
      }

      const u: Utterance = { id, origLang: detected, origText: text, texts, offsetMs, durationMs };
      opts.onFinal(u);
    } catch (e) {
      opts.onError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      this.inflight -= 1;
    }
  }

  /** Путь A — ключ пользователя в браузере. Путь B — серверный прокси,
   *  доступен только в обычной сборке. Провайдер выбирает по конфигу
   *  и в остальном не меняется (§5). */
  private request(body: unknown): Promise<Response> {
    const key = loadApiKey();
    if (key) {
      return fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    return fetch('/api/transcribe-chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async stop(): Promise<void> {
    await this.vad?.stop();
    this.vad = null;
    if (this.ownsStream) this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ownsStream = false;
    this.opts?.onStatus('stopped');
    this.opts = null;
  }
}
