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

/** Счётчик расхода — суточный лимит free tier это главное ограничение (§4). */
export const quota = {
  used: 0,
  listeners: new Set<(n: number) => void>(),
  bump() {
    this.used += 1;
    for (const l of this.listeners) l(this.used);
  },
  subscribe(fn: (n: number) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },
};

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
  private lastSentAt = 0;

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

    // Клиентский rate limiting: залипший VAD способен сжечь суточный лимит
    // за минуту, и это одинаково верно для обеих целей сборки (§5).
    const now = performance.now();
    if (this.inflight >= 3 || now - this.lastSentAt < 400) return;
    this.lastSentAt = now;
    this.inflight += 1;

    const id = uid('g');
    const offsetMs = Math.round(now - this.t0);
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

      const res = await this.request(body);
      quota.bump();

      if (!res.ok) {
        const text = await res.text();
        // 429 показываем по-человечески, а не кодом (§8).
        throw new Error(
          res.status === 429
            ? 'Gemini daily quota exhausted. Switching this channel to pinned on-device mode.'
            : `Gemini error ${res.status}: ${text.slice(0, 200)}`,
        );
      }

      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
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
