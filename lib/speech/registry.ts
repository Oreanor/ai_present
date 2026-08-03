import type { LangMode, MeetingProfile } from '../types';
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

/** Провайдер выбирается режимом определения языка, а не стадией проекта (§4):
 *  pin → Web Speech (быстро, безлимитно), auto → Gemini (умеет определять). */
export function providerForMode(mode: LangMode): ProviderId {
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
  const presenter = providerForMode(p.presenterMode);
  const audience = providerForMode(p.audienceMode);
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
