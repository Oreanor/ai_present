'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createProvider, planChannels, type ProviderId } from '@/lib/speech/registry';
import type { SpeechProvider } from '@/lib/speech/types';
import { useStore } from '@/lib/store';
import type { Lang, Speaker } from '@/lib/types';

/**
 * Управление каналами распознавания.
 *
 * Слушаем обоих сразу. Выбора «кого слушать» нет: он существовал из-за
 * ограничения Azure на один одновременный поток, а Azure из проекта ушёл.
 * Переключать каналы посреди разговора всё равно некогда.
 */
export function useChannels(terms: RefObject<string[]>) {
  const providers = useRef<Partial<Record<Speaker, SpeechProvider>>>({});
  const [listening, setListening] = useState(false);

  const start = useCallback(
    async (speaker: Speaker, id: ProviderId) => {
      const st = useStore.getState();
      await providers.current[speaker]?.stop();

      const p = createProvider(id);
      providers.current[speaker] = p;

      const isPresenter = speaker === 'presenter';
      const mode = isPresenter ? st.profile.presenterMode : st.profile.audienceMode;
      const langs = isPresenter ? st.profile.presenterLangs : st.profile.audienceLangs;

      let source: { kind: 'mic' } | { kind: 'stream'; stream: MediaStream } = { kind: 'mic' };

      // Звук встречи Web Speech принять не может — только поток захвата,
      // и только через провайдера, который умеет с потоком работать.
      if (!isPresenter && id !== 'mock') {
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
          stream.getVideoTracks().forEach((t) => t.stop()); // видео не нужно
          if (!stream.getAudioTracks().length) {
            st.toast_('No system audio — pick "Entire screen" and tick "Also share system audio".', 'error');
            return;
          }
          source = { kind: 'stream', stream };
        } catch {
          st.toast_('Screen capture cancelled — only your microphone is being heard.', 'warn');
          return;
        }
      }

      await p.start({
        source,
        sourceLang: mode.kind === 'pin' ? [mode.current] : langs,
        targetLangs: st.profile.transcriptLangs,
        phrases: terms.current ?? [],
        onPartial: (u) => useStore.getState().ingest(u, speaker, false),
        onFinal: (u) => useStore.getState().ingest(u, speaker, true),
        onTranslation: (id_, lang, text) => useStore.getState().applyTranslation(id_, lang, text),
        onError: (e) => useStore.getState().toast_(e.message, 'error'),
        onStatus: (status) => useStore.getState().setStatus(speaker, status),
      });
    },
    [terms],
  );

  const stop = useCallback(async (speaker: Speaker) => {
    await providers.current[speaker]?.stop();
    delete providers.current[speaker];
    useStore.getState().setStatus(speaker, 'idle');
  }, []);

  /** Микрофон стартует первым и работает, даже если захват звука встречи
   *  отменили: своя речь важнее второго разрешения. */
  const startAll = useCallback(async () => {
    const plan = planChannels(useStore.getState().profile);
    setListening(true);
    await start('presenter', plan.presenter);
    await start('audience', plan.audience);
  }, [start]);

  const stopAll = useCallback(async () => {
    setListening(false);
    await stop('presenter');
    await stop('audience');
  }, [stop]);

  /** Клавиша L — сменить язык микрофона, не разрывая сессию. */
  const setPresenterLanguage = useCallback((lang: Lang) => {
    providers.current.presenter?.setLanguage?.(lang);
  }, []);

  /** Клавиша G — аварийно перекинуть микрофон на другой движок. */
  const swapPresenter = useCallback(async () => {
    const current = providers.current.presenter?.id as ProviderId | undefined;
    if (!current) {
      useStore.getState().toast_('Microphone is not running.', 'warn');
      return null;
    }
    const next: ProviderId = current === 'free' ? 'gemini' : 'free';
    await start('presenter', next);
    return next;
  }, [start]);

  useEffect(() => {
    const live = providers.current;
    return () => {
      void live.presenter?.stop();
      void live.audience?.stop();
    };
  }, []);

  return { listening, start, stop, startAll, stopAll, setPresenterLanguage, swapPresenter };
}
