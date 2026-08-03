'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnnotationLayer } from '@/components/AnnotationLayer';
import { ChatLog } from '@/components/ChatLog';
import { SlideCanvas, type SlideRect } from '@/components/SlideCanvas';
import { KEY_TIERS, SetupWizard } from '@/components/SetupWizard';
import { SIDE_MIN_FRACTION, sideRoom } from '@/components/CaptionColumn';
import { getBus, type BusMessage } from '@/lib/bus';
import { exportAll, download, flaggedMarkdown, fullMarkdown } from '@/lib/export';
import { extractTerms } from '@/lib/glossary';
import { attachHotkeys, HOTKEY_HELP, type Command } from '@/lib/hotkeys';
import { openDeck, PageRenderer, type Deck } from '@/lib/pdf';
import { modeLabel, requiredPairs } from '@/lib/profile';
import { getTranslator, pairAvailability } from '@/lib/speech/translator';
import { createProvider, planChannels, type ProviderId } from '@/lib/speech/registry';
import type { SpeechProvider } from '@/lib/speech/types';
import { quota } from '@/lib/speech/gemini-provider';
import { fingerprint, loadProfile, loadTier } from '@/lib/storage';
import { hydrateStore, useStore } from '@/lib/store';
import { LANG_NAMES, type MeetingProfile, type Speaker } from '@/lib/types';
import { arrange, openPresentation } from '@/lib/windows';

/**
 * Окно ведущего. Раскладка повторяет то, что видит зал, чтобы не надо
 * было мысленно переводить одно в другое:
 *
 *   слева слайд на три четверти  ·  справа переписка  ·  внизу субтитр
 *
 * Кнопок в верхней панели ровно столько, сколько нужно во время
 * выступления. Всё остальное — под «⋯», потому что во время доклада
 * туда никто не полезет, а глаза оно отвлекает постоянно.
 */
export default function ControlPage() {
  const s = useStore();
  const [ready, setReady] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [renderer, setRenderer] = useState<PageRenderer | null>(null);
  const [rect, setRect] = useState<SlideRect>({ x: 0, y: 0, w: 0, h: 0 });
  const [stage, setStage] = useState({ w: 0, h: 0 });

  const [elapsed, setElapsed] = useState(0);
  const [demo, setDemo] = useState(false);
  const [used, setUsed] = useState(0);
  const [menu, setMenu] = useState(false);

  const bus = useRef(getBus());
  const presentWin = useRef<Window | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const providers = useRef<Partial<Record<Speaker, SpeechProvider>>>({});
  const terms = useRef<string[]>([]);

  useEffect(() => {
    hydrateStore();
    setWizard(loadProfile() === null);
    void useStore.getState().restoreLog();
    // Лимиты зависят от тарифа ключа, а API их не сообщает — берём
    // из настроек. Ошибиться здесь значит ловить 429 на первых репликах.
    const t = KEY_TIERS.find((x) => x.id === loadTier()) ?? KEY_TIERS[0];
    quota.setLimits(t.rpm, t.rpd);
    setReady(true);
    const off = quota.subscribe(setUsed);
    return () => {
      off();
    };
  }, [wizard]);

  const snapshot = useStore((st) => st.snapshot);
  useEffect(() => {
    if (!ready) return;
    bus.current.send({ type: 'state', payload: snapshot() });
  }, [
    ready,
    snapshot,
    s.slideIndex,
    s.captions,
    s.annotations,
    s.captionLine,
    s.shapeKind,
    s.shapeColor,
    s.presenterStatus,
    s.audienceStatus,
    s.mode,
  ]);

  useEffect(() => {
    return bus.current.on((m: BusMessage) => {
      const st = useStore.getState();
      switch (m.type) {
        case 'hello':
          bus.current.send({ type: 'state', payload: st.snapshot() });
          break;
        case 'nav':
          if (m.payload.delta) st.move(m.payload.delta);
          else if (m.payload.to !== undefined) st.goto(m.payload.to);
          break;
        case 'shape:add':
          st.addShape(m.payload.shape);
          break;
        case 'shape:remove':
          st.removeShape(m.payload.id);
          break;
        case 'shape:undo':
          st.undoShape();
          break;
        case 'cmd':
          runCommand(m.payload.name as Command);
          break;
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ready, wizard]);

  useEffect(() => {
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // --- команды ------------------------------------------------------------

  const runCommand = useCallback((c: Command) => {
    const st = useStore.getState();
    switch (c) {
      case 'next': st.move(1); break;
      case 'prev': st.move(-1); break;
      case 'first': st.goto(0); break;
      case 'last': st.goto(st.slideCount - 1); break;
      // Клавиша M больше не переключает «кого слушать» — слушаем обоих
      // всегда. Она стала тумблером самого прослушивания.
      case 'mode':
        void (st.presenterStatus === 'listening' || st.audienceStatus === 'listening' ? stopAll() : startAll());
        break;
      case 'captions': st.setCaptions({ visible: !st.captions.visible }); break;
      case 'lang': {
        const next = st.cyclePresenterLang();
        if (next) {
          providers.current.presenter?.setLanguage?.(next);
          st.toast_(`Microphone is now ${LANG_NAMES[next]}`);
        } else st.toast_('Language is detected automatically — nothing to switch.', 'warn');
        break;
      }
      case 'gemini': void swapPresenterProvider(); break;
      case 'flag': st.flagLast(); break;
      case 'export': exportAll(st.entries, st.profile); break;
      case 'fullscreen': presentWin.current?.focus(); break;
      case 'shapeKind': st.cycleShapeKind(); break;
      case 'clearSlide': st.clearShapes(false); break;
      case 'clearAll':
        if (confirm('Erase annotations on every slide?')) st.clearShapes(true);
        break;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => attachHotkeys(runCommand), [runCommand]);

  // --- колода -------------------------------------------------------------

  const openFile = async (file: File) => {
    const st = useStore.getState();
    try {
      const d = await openDeck(file);
      const id = await fingerprint(file);
      const r = new PageRenderer(d);
      setDeck(d);
      setRenderer(r);
      st.setDeck(id, d.pageCount, d.aspect);
      for (const w of d.warnings) st.toast_(w.text, 'warn');

      const texts: string[] = [];
      for (let i = 0; i < d.pageCount; i++) texts.push(await r.text(i));
      terms.current = extractTerms(texts);

      const room = sideRoom(16 / 9, d.aspect);
      if (room >= SIDE_MIN_FRACTION && st.captions.layout !== 'side') {
        st.toast_(
          `This deck leaves ${Math.round(room * 100)}% of the shared window empty — ` +
            'the "side" caption layout can use it. See ⋯ → Caption layout.',
        );
      }
    } catch (e) {
      st.toast_(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  // --- распознавание ------------------------------------------------------

  const startChannel = async (speaker: Speaker, id: ProviderId) => {
    const st = useStore.getState();
    await providers.current[speaker]?.stop();

    const p = createProvider(id);
    providers.current[speaker] = p;
    const isPresenter = speaker === 'presenter';
    const mode = isPresenter ? st.profile.presenterMode : st.profile.audienceMode;
    const langs = isPresenter ? st.profile.presenterLangs : st.profile.audienceLangs;

    let source: { kind: 'mic' } | { kind: 'stream'; stream: MediaStream } = { kind: 'mic' };
    if (!isPresenter && id !== 'mock') {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        stream.getVideoTracks().forEach((t) => t.stop());
        if (!stream.getAudioTracks().length) {
          st.toast_('No system audio — pick "Entire screen" and tick "Also share system audio".', 'error');
          return;
        }
        source = { kind: 'stream', stream };
      } catch {
        st.toast_('Screen capture cancelled.', 'warn');
        return;
      }
    }

    await p.start({
      source,
      sourceLang: mode.kind === 'pin' ? [mode.current] : langs,
      targetLangs: st.profile.transcriptLangs,
      phrases: terms.current,
      onPartial: (u) => useStore.getState().ingest(u, speaker, false),
      onFinal: (u) => useStore.getState().ingest(u, speaker, true),
      onTranslation: (uid_, lang, text) => useStore.getState().applyTranslation(uid_, lang, text),
      onError: (e) => useStore.getState().toast_(e.message, 'error'),
      onStatus: (status) => useStore.getState().setStatus(speaker, status),
    });
  };

  const stopChannel = async (speaker: Speaker) => {
    await providers.current[speaker]?.stop();
    delete providers.current[speaker];
    useStore.getState().setStatus(speaker, 'idle');
  };

  const swapPresenterProvider = async () => {
    const st = useStore.getState();
    const current = providers.current.presenter?.id as ProviderId | undefined;
    if (!current) {
      st.toast_('Microphone is not running.', 'warn');
      return;
    }
    const next: ProviderId = current === 'free' ? 'gemini' : 'free';
    await startChannel('presenter', next);
    st.toast_(`Microphone engine: ${next}`);
  };

  /**
   * Слушаем обоих сразу. Выбора «кого слушать» больше нет: он существовал
   * из-за ограничения Azure на один одновременный поток, а Azure из проекта
   * ушёл. Нажимать туда-сюда посреди разговора всё равно некогда.
   *
   * Микрофон стартует первым и работает, даже если захват звука встречи
   * отменили: своя речь важнее, и терять её из-за отказа во втором
   * разрешении нельзя.
   */
  const startAll = async () => {
    const st = useStore.getState();
    setDemo(false);
    st.setMode('both');
    const plan = planChannels(st.profile);
    await startChannel('presenter', plan.presenter);
    await startChannel('audience', plan.audience);
  };

  const stopAll = async () => {
    await stopChannel('presenter');
    await stopChannel('audience');
    setDemo(false);
  };

  useEffect(() => {
    return () => {
      void providers.current.presenter?.stop();
      void providers.current.audience?.stop();
      renderer?.destroy();
    };
  }, [renderer]);

  if (!ready) return <div className="p-6 text-sm text-dim">Loading…</div>;
  if (wizard)
    return (
      <SetupWizard
        onDone={(p) => {
          useStore.getState().setProfile(p);
          setWizard(false);
        }}
      />
    );

  const plan = planChannels(s.profile);
  const shapes = s.annotations[s.slideIndex] ?? [];
  const listening = s.presenterStatus === 'listening' || s.audienceStatus === 'listening';

  // Крупная строка внизу: во время Q&A это вопрос на языке ведущего,
  // иначе — то, что прямо сейчас читает зал.
  const finals = s.entries.filter((e) => e.isFinal);
  const last = finals[finals.length - 1];
  const roomAsked = last?.speaker === 'audience';
  // После перезагрузки живой строки нет, а лог восстановлен из хранилища —
  // берём последнюю запись, иначе строка врёт «ничего не сказано», а под
  // ней висит оригинал этого самого «ничего».
  const bigText = roomAsked
    ? last.texts[s.profile.transcriptLangs[0]]
    : (s.captionLine?.text ?? last?.texts[s.profile.captionLang]);
  const bigSub = bigText && last?.origText !== bigText ? last?.origText : null;

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      {/* Верхней панели нет: она забирала высоту у слайда ради кнопок,
          которыми пользуются раз за встречу. Управление — справа над чатом. */}
      <div className="flex min-h-0 flex-1">
        {/* Слайд во всю высоту. Навигация — прозрачными зонами по краям,
            чтобы не отрезать полосу снизу. */}
        <div ref={stageRef} className="relative min-h-0 flex-1 bg-black">
          {renderer && deck ? (
            <>
              <SlideCanvas
                renderer={renderer}
                index={s.slideIndex}
                aspect={deck.aspect}
                areaW={stage.w}
                areaH={stage.h}
                onRect={setRect}
              />
              <AnnotationLayer shapes={shapes} rect={rect} interactive={false} />
              <EdgeNav side="left" onClick={() => s.move(-1)} disabled={s.slideIndex === 0} />
              <EdgeNav side="right" onClick={() => s.move(1)} disabled={s.slideIndex >= s.slideCount - 1} />
              <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-0.5 font-mono text-[11px] text-dim">
                {s.slideIndex + 1} / {s.slideCount}
              </div>
            </>
          ) : (
            <DeckDrop onFile={openFile} />
          )}

          {s.toast ? (
            <div
              className={`absolute inset-x-0 top-0 px-3 py-1.5 text-xs ${
                s.toast.kind === 'error'
                  ? 'bg-err/85 text-black'
                  : s.toast.kind === 'warn'
                    ? 'bg-warn/85 text-black'
                    : 'bg-black/75 text-fg'
              }`}
            >
              {s.toast.text}
            </div>
          ) : null}
        </div>

        <aside className="flex min-h-0 w-[26%] min-w-[290px] flex-col border-l border-line bg-panel/40">
          {/* Управление — здесь, а не сверху.
              Выбора «кого слушать» нет: слушаем обоих всегда. Он существовал
              из-за ограничения Azure на один одновременный поток, а Azure
              из проекта ушёл. Web Speech и Gemini — разные сервисы, и
              переключать их посреди разговора незачем и некогда. */}
          <div className="shrink-0 border-b border-line p-2">
            <div className="flex gap-1">
              <button
                onClick={() => void (listening ? stopAll() : startAll())}
                className={`flex-1 rounded px-2 py-2 text-xs font-semibold ${
                  listening ? 'border border-line text-err' : 'bg-ok text-black'
                }`}
                title={
                  listening
                    ? 'Stop listening to both the microphone and the meeting'
                    : 'Listen to my microphone and the meeting audio at the same time'
                }
              >
                {listening ? 'Stop listening' : 'Start listening'}
              </button>
              <span className="flex items-center gap-2 rounded border border-line px-2 text-[10px] uppercase text-dim">
                <span className="flex items-center gap-1" title={`Microphone: ${s.presenterStatus}`}>
                  <Dot status={s.presenterStatus} />
                  me
                </span>
                <span className="flex items-center gap-1" title={`Meeting audio: ${s.audienceStatus}`}>
                  <Dot status={s.audienceStatus} />
                  room
                </span>
              </span>
            </div>

            <div className="mt-1 flex items-center gap-1">
              {/* Субтитры скрываются клавишей H — она и есть аварийный
                  орган. Кнопка в панели дублировала её и занимала место;
                  осталась в меню и появляется здесь, только когда полоса
                  уже погашена, чтобы это нельзя было забыть. */}
              {!s.captions.visible ? (
                <button
                  onClick={() => runCommand('captions')}
                  className="flex-1 rounded bg-err px-2 py-1.5 text-xs font-semibold text-black"
                  title="Captions are hidden from the audience. Click or press H to bring them back."
                >
                  Captions HIDDEN
                </button>
              ) : (
                <span className="flex-1 font-mono text-[11px] text-dim" title="Time since this window was opened">
                  {fmt(elapsed)}
                </span>
              )}
              <button
                onClick={() => runCommand('lang')}
                disabled={s.profile.presenterMode.kind !== 'pin'}
                className="rounded border border-line px-2.5 py-1.5 text-xs font-bold disabled:opacity-40"
                title="Which language I am speaking right now. Press before you switch. Shortcut: L"
              >
                {modeLabel(s.profile.presenterMode)}
              </button>
              <div className="relative">
                <button
                  onClick={() => setMenu((v) => !v)}
                  className="rounded border border-line px-2.5 py-1.5 text-xs"
                  title="Everything you do not need mid-talk"
                >
                  ⋯
                </button>
                {menu ? (
                  <Menu
                    onClose={() => setMenu(false)}
                    state={s}
                    deck={deck}
                    demo={demo}
                    setDemo={setDemo}
                    startChannel={startChannel}
                    stopChannel={stopChannel}
                    used={used}
                    plan={plan}
                    openWizard={() => setWizard(true)}
                    openPresent={() => {
                      presentWin.current = openPresentation(deck?.aspect);
                    }}
                    arrangeWindows={() => arrange(presentWin.current, deck?.aspect)}
                  />
                ) : null}
              </div>
            </div>
          </div>

          <ChatLog
            entries={s.entries}
            profile={s.profile}
            viewLang={s.viewLang}
            translating={s.translating}
            onSetViewLang={(l) => void s.setViewLang(l)}
            onToggleFlag={s.toggleFlag}
            onEdit={s.editEntry}
          />
        </aside>
      </div>

      {/* Крупная строка внизу */}
      {/* Высота фиксирована: иначе крупная строка выталкивает сама себя
          за край окна и обрезается ровно в тот момент, когда нужна. */}
      {/* По центру и крупно — читается боковым зрением, не отрывая
          внимания от зала. Высота фиксирована: иначе длинная фраза
          выталкивает сама себя за край окна. */}
      <footer className="flex h-[168px] shrink-0 flex-col items-center justify-center gap-1.5 border-t border-line bg-black/50 px-10 py-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-dim">
          <Dot status={s.mode === 'qa' ? s.audienceStatus : s.presenterStatus} />
          <span>{roomAsked ? 'Question from the room' : `On screen — ${LANG_NAMES[s.profile.captionLang]}`}</span>
          {s.partial ? <span className="max-w-[40ch] truncate italic text-accent/70">{s.partial}</span> : null}
        </div>
        <p className="line-clamp-2 text-center text-[34px] font-semibold leading-tight" style={{ textWrap: 'balance' }}>
          {bigText ?? <span className="text-[16px] font-normal text-dim">Nothing said yet.</span>}
        </p>
        {bigSub && bigSub !== bigText ? (
          <p className="max-w-[90%] truncate text-center text-[13px] text-dim">{bigSub}</p>
        ) : null}
      </footer>
    </main>
  );
}

/** Прозрачная зона навигации по краю слайда. Отдельной полосы под
 *  слайдом нет — она отбирала высоту у самого слайда. */
function EdgeNav({ side, onClick, disabled }: { side: 'left' | 'right'; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={side === 'left' ? 'Previous slide (←)' : 'Next slide (→)'}
      className={`group absolute inset-y-0 ${side === 'left' ? 'left-0' : 'right-0'} w-16 disabled:pointer-events-none`}
    >
      <span
        className={`absolute inset-0 transition-opacity duration-150 ${disabled ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'}`}
        style={{
          background:
            side === 'left'
              ? 'linear-gradient(90deg, rgba(0,0,0,.55), transparent)'
              : 'linear-gradient(270deg, rgba(0,0,0,.55), transparent)',
        }}
      />
      <span
        className={`absolute top-1/2 -translate-y-1/2 text-3xl leading-none transition-opacity ${
          side === 'left' ? 'left-4' : 'right-4'
        } ${disabled ? 'opacity-0' : 'opacity-25 group-hover:opacity-100'}`}
      >
        {side === 'left' ? '‹' : '›'}
      </span>
    </button>
  );
}

/** Всё, что не нужно во время выступления. */
function Menu({
  onClose,
  state,
  deck,
  demo,
  setDemo,
  startChannel,
  stopChannel,
  used,
  plan,
  openWizard,
  openPresent,
  arrangeWindows,
}: {
  onClose: () => void;
  state: ReturnType<typeof useStore.getState>;
  deck: Deck | null;
  demo: boolean;
  setDemo: (v: boolean) => void;
  startChannel: (s: Speaker, id: ProviderId) => Promise<void>;
  stopChannel: (s: Speaker) => Promise<void>;
  used: number;
  plan: ReturnType<typeof planChannels>;
  openWizard: () => void;
  openPresent: () => void;
  arrangeWindows: () => void;
}) {
  const roomy = sideRoom(16 / 9, deck?.aspect ?? 16 / 9) >= SIDE_MIN_FRACTION;
  const item = 'w-full rounded px-2 py-1.5 text-left text-xs hover:bg-white/5';

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 top-9 z-20 w-72 rounded-lg border border-line bg-panel p-2 shadow-2xl">
        <Group label="The window you share in Teams">
          <button className={item} onClick={openPresent}>
            Open the presentation window
          </button>
          <button className={item} onClick={arrangeWindows}>
            Place both windows side by side
          </button>
        </Group>

        <Group label="Caption layout — where subtitles sit in the shared window">
          <div className="flex gap-1">
            {(['reserve', 'overlay', 'side'] as const).map((l) => (
              <button
                key={l}
                onClick={() => state.setCaptions({ layout: l })}
                disabled={l === 'side' && !roomy}
                className={`flex-1 rounded px-2 py-1 text-xs ${
                  state.captions.layout === l ? 'bg-accent font-semibold text-black' : 'border border-line'
                } disabled:opacity-35`}
                title={
                  l === 'reserve'
                    ? 'Bar under the slide; the slide shrinks a little'
                    : l === 'overlay'
                      ? 'Bar on top of the slide'
                      : roomy
                        ? 'Column beside the slide — uses the empty margins of a narrow deck'
                        : 'No room: the slide already fills the width'
                }
              >
                {l}
              </button>
            ))}
          </div>
        </Group>

        <PackList profile={state.profile} />

        <Group label="Rehearse without a microphone">
          <button
            className={item}
            onClick={() => {
              if (demo) {
                void stopChannel('presenter');
                setDemo(false);
              } else {
                void startChannel('presenter', 'mock');
                setDemo(true);
              }
            }}
          >
            {demo ? '■ Stop demo playback' : '▶ Play a recorded demo'}
          </button>
        </Group>

        <Group label="Export">
          <button className={item} onClick={() => download('log-full.md', fullMarkdown(state.entries, state.profile))}>
            Full log with originals
          </button>
          <button
            className={item}
            onClick={() => download('follow-up.md', flaggedMarkdown(state.entries, state.profile.transcriptLangs[0]))}
          >
            Flagged items only
          </button>
        </Group>

        <Group label="Session">
          <button
            className={`${item} text-err`}
            onClick={() => {
              if (confirm('Erase the whole log? Export first if you need it.')) state.clearLog();
            }}
          >
            Clear the log
          </button>
          <button className={item} onClick={openWizard}>
            Languages and setup…
          </button>
          {plan.presenter === 'gemini' || plan.audience === 'gemini' ? (
            <p className="px-2 py-1 text-[11px] text-dim">Gemini requests used: {used}</p>
          ) : null}
        </Group>

        <Group label="Keyboard">
          {HOTKEY_HELP.map((h) => (
            <div key={h.keys} className="flex justify-between gap-2 px-2 py-0.5 text-[11px]">
              <span className="font-mono text-accent">{h.keys}</span>
              <span className="text-dim">{h.label}</span>
            </div>
          ))}
        </Group>
      </div>
    </>
  );
}

/**
 * Языковые пакеты прямо в меню. Раньше они жили только в мастере первого
 * запуска, и это оказалось главной причиной, по которой перевод молча
 * не работал: скачивание требует свежего клика, а из колбэка распознавания
 * его нет. Здесь клик есть.
 */
function PackList({ profile }: { profile: MeetingProfile }) {
  const pairs = requiredPairs(profile);
  const [status, setStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const { from, to } of pairs) next[`${from}>${to}`] = await pairAvailability(from, to);
      if (!cancelled) setStatus((prev) => ({ ...next, ...prev }));
    })();
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(pairs)]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = pairs.filter(({ from, to }) => status[`${from}>${to}`] !== 'available');
  if (!pending.length) return null;

  return (
    <Group label="Translation packs — download before you start, one click each">
      {pending.map(({ from, to }) => {
        const key = `${from}>${to}`;
        return (
          <div key={key} className="flex items-center gap-2 px-2 py-0.5 text-xs">
            <span className="font-mono">
              {from} → {to}
            </span>
            <span className="text-dim">{status[key] ?? '…'}</span>
            <button
              onClick={async () => {
                setStatus((p) => ({ ...p, [key]: 'downloading' }));
                try {
                  await getTranslator(from, to);
                  setStatus((p) => ({ ...p, [key]: 'available' }));
                } catch (e) {
                  setStatus((p) => ({ ...p, [key]: e instanceof Error ? e.name : 'error' }));
                }
              }}
              className="ml-auto rounded border border-line px-1.5 py-0.5"
            >
              Download
            </button>
          </div>
        );
      })}
    </Group>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 border-b border-line pb-2 last:mb-0 last:border-0 last:pb-0">
      <p className="px-2 pb-1 text-[10px] uppercase tracking-wide text-dim">{label}</p>
      {children}
    </div>
  );
}

function Dot({ status }: { status: string }) {
  const color =
    status === 'listening'
      ? 'var(--color-ok)'
      : status === 'connecting' || status === 'reconnecting'
        ? 'var(--color-warn)'
        : status === 'error'
          ? 'var(--color-err)'
          : 'var(--color-line)';
  return <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} title={status} />;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${String(m).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function DeckDrop({ onFile }: { onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`absolute inset-0 m-4 flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed text-sm transition-colors ${
        over ? 'border-accent text-fg' : 'border-line text-dim'
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f?.name.toLowerCase().endsWith('.pdf')) void onFile(f);
      }}
    >
      <input
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      <span className="text-center">
        Drop your PDF here
        <br />
        <span className="text-xs opacity-60">or click to choose</span>
      </span>
    </label>
  );
}
