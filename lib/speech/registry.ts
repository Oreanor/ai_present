import type { LangMode, MeetingProfile, Speaker } from '../types';
import { FreeProvider, webSpeechSupported } from './free-provider';
import { GeminiChunkProvider } from './gemini-provider';
import { MockProvider } from './mock-provider';
import type { SpeechProvider } from './types';

export type ProviderId = 'free' | 'gemini' | 'mock';

export function createProvider(id: ProviderId): SpeechProvider {
  switch (id) {
    case 'free':
      return new FreeProvider();
    case 'gemini':
      return new GeminiChunkProvider();
    case 'mock':
      return new MockProvider();
  }
}

/**
 * Провайдер выбирается каналом и режимом (§4).
 *
 * Микрофон: pin → Web Speech (быстро, безлимитно), auto → Gemini (только
 * он определяет язык).
 *
 * Зал — всегда Gemini. Web Speech не принимает поток захвата экрана и не
 * поднимает вторую одновременную сессию: пин зала на нём означал бы второй
 * распознаватель на том же микрофоне, который убивает первый. Пин здесь —
 * подсказка языка модели, а не другой движок: он дешевле и точнее авто.
 */
export function providerFor(ch: Speaker, mode: LangMode): ProviderId {
  if (ch === 'audience') return 'gemini';
  return mode.kind === 'pin' ? 'free' : 'gemini';
}

export type ChannelPlan = {
  presenter: ProviderId;
  audience: ProviderId;
  /** Доступен ли режим Both — вычисляется из capabilities, не хардкодится (§8). */
  bothAvailable: boolean;
  warnings: string[];
};

export function planChannels(p: MeetingProfile): ChannelPlan {
  const presenter = providerFor('presenter', p.presenterMode);
  const audience = providerFor('audience', p.audienceMode);
  const warnings: string[] = [];

  const a = createProvider(presenter).capabilities;
  const b = createProvider(audience).capabilities;

  // Both недоступен только если оба канала на одном провайдере,
  // который тянет меньше двух сессий.
  const bothAvailable = presenter !== audience || Math.min(a.concurrentSessions, b.concurrentSessions) >= 2;

  if (presenter === 'gemini' && audience === 'gemini') {
    warnings.push(
      'Both channels are on Gemini and share one daily quota. Pinning the microphone language ' +
        'removes that limit entirely and makes captions about 20x faster.',
    );
  }
  if (presenter === 'free' && !webSpeechSupported()) {
    warnings.push('Web Speech is unavailable here, so the microphone must run on Gemini. Switch the mode to auto.');
  }
  if (!bothAvailable) {
    warnings.push('The Both mode is unavailable with this provider combination.');
  }
  return { presenter, audience, bothAvailable, warnings };
}
