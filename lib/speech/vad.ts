// VAD — обязательный компонент, а не оптимизация (§7). Решает две задачи:
// не отправлять тишину (иначе суточный лимит уходит в пустоту) и задавать
// границы чанка, чтобы реплика улетала на распознавание сразу по окончании
// речи. Второе стало критичным, когда вопросы зала пошли в субтитры.

export type VadOptions = {
  onUtterance(pcm: Float32Array, sampleRate: number, durationMs: number): void;
  onLevel?(rms: number): void;
  /** Порог входа в речь. */
  speechOn?: number;
  /** Порог выхода — ниже входного, гистерезис против дребезга. */
  speechOff?: number;
  /** Сколько тишины закрывает реплику. */
  silenceMs?: number;
  /** Короче этого — шум, не реплика. */
  minUtteranceMs?: number;
  /** Страховка от бесконечного монолога. */
  maxUtteranceMs?: number;
  /** Сколько звука до начала речи прикладывать: без этого срезается
   *  первый слог, и распознавание теряет начало фразы. */
  preRollMs?: number;
};

export class Vad {
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private src: MediaStreamAudioSourceNode | null = null;

  private speaking = false;
  private buf: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private lastLoud = 0;
  private startedAt = 0;

  constructor(private opts: VadOptions) {}

  async start(stream: MediaStream): Promise<void> {
    // 16 кГц запрашиваем прямо у AudioContext — Chrome ресемплит сам,
    // собственный ресемплер писать не нужно (§7).
    const ctx = new AudioContext({ sampleRate: 16000 });
    this.ctx = ctx;
    this.src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    this.node = node;

    const on = this.opts.speechOn ?? 0.012;
    const off = this.opts.speechOff ?? 0.006;
    const silenceMs = this.opts.silenceMs ?? 700;
    const minMs = this.opts.minUtteranceMs ?? 400;
    const maxMs = this.opts.maxUtteranceMs ?? 30_000;
    const preRollMs = this.opts.preRollMs ?? 300;
    const preRollMax = (preRollMs / 1000) * ctx.sampleRate;

    node.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const chunk = new Float32Array(input);

      let sum = 0;
      for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
      const rms = Math.sqrt(sum / chunk.length);
      this.opts.onLevel?.(rms);

      const now = performance.now();

      if (!this.speaking) {
        this.preRoll.push(chunk);
        this.preRollSamples += chunk.length;
        while (this.preRollSamples > preRollMax && this.preRoll.length > 1) {
          this.preRollSamples -= this.preRoll.shift()!.length;
        }
        if (rms > on) {
          this.speaking = true;
          this.startedAt = now;
          this.lastLoud = now;
          this.buf = [...this.preRoll];
          this.preRoll = [];
          this.preRollSamples = 0;
        }
        return;
      }

      this.buf.push(chunk);
      if (rms > off) this.lastLoud = now;

      const silent = now - this.lastLoud > silenceMs;
      const tooLong = now - this.startedAt > maxMs;
      if (silent || tooLong) {
        const durationMs = Math.round(this.lastLoud - this.startedAt);
        const flat = this.flatten();
        this.speaking = false;
        this.buf = [];
        if (durationMs >= minMs) this.opts.onUtterance(flat, ctx.sampleRate, durationMs);
      }
    };

    this.src.connect(node);
    // ScriptProcessor не тикает без подключения к destination; гейн в ноль,
    // иначе получим эхо собственного микрофона в колонках.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute);
    mute.connect(ctx.destination);
  }

  private flatten(): Float32Array {
    const total = this.buf.reduce((a, c) => a + c.length, 0);
    const out = new Float32Array(total);
    let off = 0;
    for (const c of this.buf) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  async stop(): Promise<void> {
    if (this.node) this.node.onaudioprocess = null;
    this.node?.disconnect();
    this.src?.disconnect();
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.node = null;
    this.src = null;
    this.buf = [];
    this.preRoll = [];
    this.preRollSamples = 0;
    this.speaking = false;
  }
}

/** WAV PCM16. Gemini не принимает webm/opus, а WAV принимает. */
export function encodeWav(pcm: Float32Array, sampleRate: number): Blob {
  const n = pcm.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export function blobToBase64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}
