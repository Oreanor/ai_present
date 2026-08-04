'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { transcriptLangs } from '@/lib/profile';
import { detectProfanity } from '@/lib/easter-egg';
import { matchVoiceCommand, type VoiceCommand } from '@/lib/voice-commands';
import { createProvider, planChannels, providerFor, type ProviderId } from '@/lib/speech/registry';
import type { SpeechProvider } from '@/lib/speech/types';
import { useStore } from '@/lib/store';
import type { Speaker } from '@/lib/types';

/**
 * Что голос умеет делать с колодами. Живёт снаружи: колоды держит useDeck,
 * и тянуть его сюда значило бы связать распознавание с разбором PDF.
 */
export type DeckVoice = {
  /** Открыть N-ю из галереи недавних, считая с единицы. */
  openNth(n: number): void;
  close(): void;
  /** Сколько их там — чтобы не открывать десятую из трёх молча. */
  count(): number;
};

/** Исполнение голосовой команды. Обзор закрывается сам, когда просят
 *  конкретный слайд: раз назвали номер — хотят его, а не список. */
function runVoiceCommand(
  cmd: VoiceCommand,
  deck: DeckVoice | null,
  applyMode: (who: Speaker) => void,
): void {
  const st = useStore.getState();
  switch (cmd.kind) {
    case 'channel': {
      const p = st.profile;
      const langs = cmd.who === 'presenter' ? p.presenterLangs : p.audienceLangs;
      const name = cmd.who === 'presenter' ? 'Microphone' : 'Room';

      // Приколоть можно только к языку, который в профиле есть: иначе
      // профиль становится негодным, и normalizeModes молча вернёт его
      // обратно — команда бы «сработала» и ничего не изменила.
      if (cmd.mode.kind === 'pin' && !langs.includes(cmd.mode.current)) {
        st.toast_(`${name}: ${cmd.mode.current.toUpperCase()} is not in this channel's languages.`, 'warn');
        break;
      }
      // Авто — это определение языка моделью, то есть Gemini и ключ.
      if (cmd.mode.kind === 'auto' && langs.length < 2) {
        st.toast_(`${name}: auto needs at least two languages in the profile.`, 'warn');
        break;
      }

      st.setProfile(
        cmd.who === 'presenter' ? { ...p, presenterMode: cmd.mode } : { ...p, audienceMode: cmd.mode },
      );
      applyMode(cmd.who);
      st.toast_(`${name}: ${cmd.mode.kind === 'auto' ? 'auto' : cmd.mode.current.toUpperCase()}`);
      break;
    }
    case 'next': st.move(1); st.setOverview(false); break;
    case 'prev': st.move(-1); st.setOverview(false); break;
    case 'first': st.goto(0); st.setOverview(false); break;
    case 'last': st.goto(st.slideCount - 1); st.setOverview(false); break;
    case 'goto': st.goto(cmd.slide - 1); st.setOverview(false); break;
    case 'overview': st.setOverview(true); break;
    case 'readIn': void st.setViewLang(cmd.lang); break;
    case 'close': deck?.close(); break;
    case 'open': {
      const have = deck?.count() ?? 0;
      // Названного номера может не быть. Молчать нельзя: человек сказал
      // команду, она разобралась, и отсутствие любой реакции читается
      // как «распознавание не работает» — сегодня это уже проходили.
      if (cmd.deck > have) {
        st.toast_(`Only ${have} presentation${have === 1 ? '' : 's'} in the gallery.`, 'warn');
        break;
      }
      deck?.openNth(cmd.deck);
      break;
    }
  }
}

/**
 * Управление каналами распознавания.
 *
 * Слушаем обоих сразу. Выбора «кого слушать» нет: он существовал из-за
 * ограничения Azure на один одновременный поток, а Azure из проекта ушёл.
 * Переключать каналы посреди разговора всё равно некогда.
 */
export function useChannels(terms: RefObject<string[]>, deckVoice: RefObject<DeckVoice | null>) {
  const providers = useRef<Partial<Record<Speaker, SpeechProvider>>>({});
  // Захваченный звук встречи переживает перезапуск канала: смена языка зала
  // иначе заново спрашивала бы разрешение на показ экрана — посреди доклада.
  const roomAudio = useRef<MediaStream | null>(null);
  const [listening, setListening] = useState(false);
  // applyMode определён ниже и сам зависит от start — через ref, иначе
  // получилась бы взаимная зависимость двух useCallback.
  const applyModeRef = useRef<((who: Speaker) => void) | null>(null);

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
          // в зале, перелистывать доклад не должно. Состояние экрана —
          // часть разбора: команда, которой некуда сработать, остаётся
          // словом и уходит в лог (см. voice-commands.ts).
          const cmd = isPresenter
            ? matchVoiceCommand(u.origText, { deckOpen: st.docId !== '' })
            : null;
          if (cmd) {
            runVoiceCommand(cmd, deckVoice.current, (who) => applyModeRef.current?.(who));
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
  applyModeRef.current = (who) => void applyMode(who);

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
