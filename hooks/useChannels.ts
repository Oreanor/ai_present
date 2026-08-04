'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { transcriptLangs } from '@/lib/profile';
import { detectProfanity } from '@/lib/easter-egg';
import { matchVoiceCommand, type VoiceCommand } from '@/lib/voice-commands';
import { createProvider, planChannels, providerFor, type ProviderId } from '@/lib/speech/registry';
import type { SpeechProvider } from '@/lib/speech/types';
import { useStore } from '@/lib/store';
import type { Speaker } from '@/lib/types';

/** Исполнение голосовой команды. Обзор закрывается сам, когда просят
 *  конкретный слайд: раз назвали номер — хотят его, а не список. */
function runVoiceCommand(cmd: VoiceCommand): void {
  const st = useStore.getState();
  switch (cmd.kind) {
    case 'next': st.move(1); st.setOverview(false); break;
    case 'prev': st.move(-1); st.setOverview(false); break;
    case 'first': st.goto(0); st.setOverview(false); break;
    case 'last': st.goto(st.slideCount - 1); st.setOverview(false); break;
    case 'goto': st.goto(cmd.slide - 1); st.setOverview(false); break;
    case 'overview': st.setOverview(true); break;
  }
}

/**
 * Управление каналами распознавания.
 *
 * Слушаем обоих сразу. Выбора «кого слушать» нет: он существовал из-за
 * ограничения Azure на один одновременный поток, а Azure из проекта ушёл.
 * Переключать каналы посреди разговора всё равно некогда.
 */
export function useChannels(terms: RefObject<string[]>) {
  const providers = useRef<Partial<Record<Speaker, SpeechProvider>>>({});
  // Захваченный звук встречи переживает перезапуск канала: смена языка зала
  // иначе заново спрашивала бы разрешение на показ экрана — посреди доклада.
  const roomAudio = useRef<MediaStream | null>(null);
  const [listening, setListening] = useState(false);

  const grabRoomAudio = useCallback(async (): Promise<MediaStream | null> => {
    const cached = roomAudio.current;
    if (cached?.getAudioTracks().some((t) => t.readyState === 'live')) return cached;

    const st = useStore.getState();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((t) => t.stop()); // видео не нужно
      if (!stream.getAudioTracks().length) {
        st.toast_('No system audio — pick "Entire screen" and tick "Also share system audio".', 'error');
        return null;
      }
      roomAudio.current = stream;
      return stream;
    } catch {
      st.toast_('Screen capture cancelled — only your microphone is being heard.', 'warn');
      return null;
    }
  }, []);

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
      if (!isPresenter) {
        const stream = await grabRoomAudio();
        if (!stream) return;
        source = { kind: 'stream', stream };
      }

      await p.start({
        source,
        sourceLang: mode.kind === 'pin' ? [mode.current] : langs,
        targetLangs: transcriptLangs(st.profile),
        phrases: terms.current ?? [],
        onPartial: (u) => useStore.getState().ingest(u, speaker, false),
        onFinal: (u) => {
          const st = useStore.getState();

          // Команды слушаем только у микрофона: «дальше», сказанное кем-то
          // в зале, перелистывать доклад не должно.
          const cmd = isPresenter ? matchVoiceCommand(u.origText) : null;
          if (cmd) {
            runVoiceCommand(cmd);
            // Промежуточный текст обычно гасит сам ingest; здесь его нет,
            // и без этого команда осталась бы висеть под слайдом.
            useStore.setState({ partial: null });
            return;
          }
          // Реплика записывается как есть: сказанное было сказано, и
          // подчищать за говорящим стенограмму — не наше дело.
          st.ingest(u, speaker, true);
          const swore = detectProfanity(u.origText);
          if (swore) st.apologise(swore);
        },
        onTranslation: (id_, lang, text) => useStore.getState().applyTranslation(id_, lang, text),
        onError: (e) => useStore.getState().toast_(e.message, 'error'),
        onStatus: (status) => useStore.getState().setStatus(speaker, status),
      });
    },
    [terms, grabRoomAudio],
  );

  const stop = useCallback(async (speaker: Speaker) => {
    await providers.current[speaker]?.stop();
    delete providers.current[speaker];
    if (speaker === 'audience') {
      roomAudio.current?.getTracks().forEach((t) => t.stop());
      roomAudio.current = null;
    }
    useStore.getState().setStatus(speaker, 'idle');
  }, []);

  /** Микрофон стартует первым и работает, даже если захват звука встречи
   *  отменили: своя речь важнее второго разрешения. */
  const startAll = useCallback(async () => {
    const plan = planChannels(useStore.getState().profile);
    // Предупреждения плана считались и выбрасывались. Из-за этого канал,
    // уехавший с Web Speech на Gemini (микрофон в AUTO), молчал без
    // единого слова о причине: движок сменился, а сказать об этом было
    // некому. Дальше по колоде это делает useDeck — здесь так же.
    for (const w of plan.warnings) useStore.getState().toast_(w, 'warn');
    setListening(true);
    await start('presenter', plan.presenter);
    await start('audience', plan.audience);
  }, [start]);

  const stopAll = useCallback(async () => {
    setListening(false);
    await stop('presenter');
    await stop('audience');
  }, [stop]);

  /**
   * Подтянуть канал под режим языка, который только что выбрали в профиле.
   * Web Speech меняет язык на живой сессии; всё остальное — смена движка
   * или переход в auto — требует перезапуска: язык задаётся при старте.
   */
  const applyMode = useCallback(
    async (speaker: Speaker) => {
      const running = providers.current[speaker];
      if (!running) return;

      const p = useStore.getState().profile;
      const mode = speaker === 'presenter' ? p.presenterMode : p.audienceMode;
      const want = providerFor(speaker, mode);

      if (running.id === want && mode.kind === 'pin' && running.setLanguage) {
        running.setLanguage(mode.current);
        return;
      }
      await start(speaker, want);
    },
    [start],
  );

  useEffect(() => {
    const live = providers.current;
    return () => {
      void live.presenter?.stop();
      void live.audience?.stop();
      roomAudio.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { listening, start, stop, startAll, stopAll, applyMode };
}
