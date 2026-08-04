'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AnnotationLayer } from '@/components/AnnotationLayer';
import { AnnotationTools } from '@/components/AnnotationTools';
import { CaptionFooter } from '@/components/CaptionFooter';
import { ChatLog } from '@/components/ChatLog';
import { ControlMenu } from '@/components/ControlMenu';
import { ReadInPicker } from '@/components/ReadInPicker';
import { StatusDot } from '@/components/StatusDot';
import { DeckGallery } from '@/components/DeckGallery';
import { EdgeNav } from '@/components/EdgeNav';
import { SlideCanvas } from '@/components/SlideCanvas';
import { KEY_TIERS, SetupWizard } from '@/components/SetupWizard';
import { useChannels } from '@/hooks/useChannels';
import { useDeck } from '@/hooks/useDeck';
import { useElementSize } from '@/hooks/useElementSize';
import { getBus, type BusMessage } from '@/lib/bus';
import { LAYOUT } from '@/lib/constants';
import { exportAll } from '@/lib/export';
import { clock, usd } from '@/lib/format';
import type { Rect } from '@/lib/geometry';
import { attachHotkeys, type Command } from '@/lib/hotkeys';
import { modeCycle, modeLabel } from '@/lib/profile';
import { planChannels } from '@/lib/speech/registry';
import { quota } from '@/lib/speech/gemini-provider';
import { loadCap, loadProfile, loadTier } from '@/lib/storage';
import { hydrateStore, useStore } from '@/lib/store';
import type { Lang, LangMode, Speaker } from '@/lib/types';
import { uid } from '@/lib/speech/types';
import { initUiPrefs, useT, useTheme, useUiLang } from '@/lib/ui-prefs';

/**
 * Окно ведущего. Раскладка повторяет то, что видит зал, чтобы не надо
 * было мысленно переводить одно в другое:
 *
 *   слева слайд во всю высоту  ·  справа переписка  ·  внизу крупная строка
 *
 * Верхней панели нет: она забирала высоту у слайда ради кнопок, которыми
 * пользуются раз за встречу. Управление — в правой колонке, всё лишнее
 * под «⋯».
 */
export default function ControlPage() {
  // Подписка поимённая, а не на весь стор: реплики и промежуточный текст
  // меняются по нескольку раз в секунду, и подписка на всё перерисовывала
  // бы слайд с разметкой на каждое распознанное слово. Действия берутся
  // из стора отдельно — они создаются один раз и перерисовок не вызывают.
  const s = useStore(
    useShallow((st) => ({
      profile: st.profile,
      captions: st.captions,
      slideIndex: st.slideIndex,
      slideCount: st.slideCount,
      annotations: st.annotations,
      shapeKind: st.shapeKind,
      shapeColor: st.shapeColor,
      presenterStatus: st.presenterStatus,
      audienceStatus: st.audienceStatus,
      toast: st.toast,
      addShape: st.addShape,
      removeShape: st.removeShape,
      moveShape: st.moveShape,
      undoShape: st.undoShape,
      move: st.move,
      snapshot: st.snapshot,
    })),
  );
  const theme = useTheme();
  const uiLang = useUiLang();
  const t = useT();

  const [ready, setReady] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [used, setUsed] = useState(0);
  const [menu, setMenu] = useState(false);

  const bus = useRef(getBus());
  const stageRef = useRef<HTMLDivElement>(null);

  const { deck, renderer, terms, recent, load, openRecent, forget } = useDeck();
  const channels = useChannels(terms);
  const stage = useElementSize(stageRef, [ready, wizard, deck]);

  // --- инициализация ------------------------------------------------------

  /** Лимиты зависят от тарифа ключа, а API их не сообщает — берём
   *  из настроек. Ошибиться здесь значит ловить 429 на первых репликах. */
  const applyQuotaLimits = useCallback(() => {
    const tier = KEY_TIERS.find((x) => x.id === loadTier()) ?? KEY_TIERS[0];
    quota.setLimits(tier.rpm, tier.rpd, loadCap());
  }, []);

  // Строго один раз. Зависимость от `wizard` здесь была ошибкой: открытие
  // настроек перезапускало эффект, тот заново вычислял wizard из наличия
  // профиля и немедленно закрывал их обратно.
  useEffect(() => {
    // Ни один шаг подготовки не должен мешать окну открыться: если что-то
    // из хранилища не читается, приложение обязано запуститься на
    // умолчаниях и сказать об этом, а не висеть на «Loading…».
    try {
      hydrateStore();
      initUiPrefs();
      setWizard(loadProfile() === null);
      applyQuotaLimits();
    } catch (e) {
      console.error('init failed', e);
    }
    void useStore.getState().restoreLog();
    setReady(true);
    const off = quota.subscribe(setUsed);
    return () => {
      off();
    };
  }, [applyQuotaLimits]);

  useEffect(() => {
    const id = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);

  /**
   * Открыть колоду. Окно показа само НЕ открывается: второе окно нужно
   * только тем, кто хочет расшарить в Teams один слайд без переписки.
   * Если делиться нечего скрывать — достаточно этого окна, а лишнее
   * всплывающее окно только мешает.
   */
  const openDeckAndWindow = useCallback(
    (file?: File, docId?: string) => {
      if (file) void load(file);
      else if (docId) void openRecent(docId);
    },
    [load, openRecent],
  );

  // --- команды ------------------------------------------------------------

  /**
   * Перебрать язык канала и подтянуть под него живое распознавание.
   * Одна процедура на микрофон и на зал: разница между каналами вся
   * внутри провайдера, а не здесь.
   */
  const cycleChannel = useCallback(
    (ch: Speaker) => {
      const st = useStore.getState();
      const next = st.cycleMode(ch);
      if (!next) return st.toast_(t('langFixedNeedsOne'), 'warn');
      void channels.applyMode(ch);
      st.toast_(`${t(ch === 'presenter' ? 'me' : 'room')} ${t('channelNowIs')} ${modeLabel(next)}`);
    },
    [channels, t],
  );

  const runCommand = useCallback(
    (c: Command) => {
      const st = useStore.getState();
      switch (c) {
        case 'next': st.move(1); break;
        case 'prev': st.move(-1); break;
        case 'first': st.goto(0); break;
        case 'last': st.goto(st.slideCount - 1); break;
        case 'mode': void (channels.listening ? channels.stopAll() : channels.startAll()); break;
        case 'captions': st.setCaptions({ visible: !st.captions.visible }); break;
        case 'lang': cycleChannel('presenter'); break;
        case 'gemini':
          void channels.swapPresenter().then((next) => {
            if (next) st.toast_(`${t('micEngine')}: ${next}`);
          });
          break;
        case 'flag': st.flagLast(); break;
        case 'export': exportAll(st.entries, st.profile); break;
        case 'fullscreen': void document.documentElement.requestFullscreen().catch(() => {}); break;
        case 'shapeKind': st.cycleShapeKind(); break;
        case 'clearSlide': st.clearShapes(false); break;
        case 'clearAll':
          if (confirm(t('clearAllShapesConfirm'))) st.clearShapes(true);
          break;
      }
    },
    [channels, cycleChannel, t],
  );

  useEffect(() => attachHotkeys(runCommand), [runCommand]);

  // --- межоконная синхронизация -------------------------------------------

  // Снимок уходит на то, что видно в окне показа. Строка субтитров сюда
  // не входит намеренно: она меняется чаще всего, а окно показа берёт её
  // из своего же потока сообщений.
  useEffect(() => {
    if (ready) bus.current.send({ type: 'state', payload: s.snapshot() });
  }, [ready, s, s.slideIndex, s.captions, s.annotations, s.shapeKind, s.shapeColor, s.presenterStatus, s.audienceStatus]);

  useEffect(() => {
    return bus.current.on((m: BusMessage) => {
      const st = useStore.getState();
      switch (m.type) {
        case 'hello': bus.current.send({ type: 'state', payload: st.snapshot() }); break;
        case 'nav':
          if (m.payload.delta) st.move(m.payload.delta);
          else if (m.payload.to !== undefined) st.goto(m.payload.to);
          break;
        case 'shape:add': st.addShape(m.payload.shape); break;
        case 'shape:remove': st.removeShape(m.payload.id); break;
        case 'shape:undo': st.undoShape(); break;
        case 'cmd': runCommand(m.payload.name as Command); break;
      }
    });
  }, [runCommand]);

  // --- отрисовка ----------------------------------------------------------

  if (!ready) return <div className="p-6 text-sm text-dim">Loading…</div>;
  if (wizard)
    return (
      <SetupWizard
        onDone={(p) => {
          useStore.getState().setProfile(p);
          // Тариф и потолок могли поменяться прямо в мастере.
          applyQuotaLimits();
          setWizard(false);
        }}
      />
    );

  const plan = planChannels(s.profile);
  const geminiInUse = plan.presenter === 'gemini' || plan.audience === 'gemini';
  const shapes = s.annotations[s.slideIndex] ?? [];

  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
        <div ref={stageRef} className="stage group/stage">
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
              <AnnotationLayer
                shapes={shapes}
                rect={rect}
                interactive
                kind={s.shapeKind}
                color={s.shapeColor}
                onAdd={(shape) => s.addShape({ ...shape, id: uid('s') })}
                onRemove={s.removeShape}
                onMove={s.moveShape}
                onUndo={s.undoShape}
              />
              <AnnotationTools />
              <EdgeNav side="left" onClick={() => s.move(-1)} disabled={s.slideIndex === 0} />
              <EdgeNav side="right" onClick={() => s.move(1)} disabled={s.slideIndex >= s.slideCount - 1} />
              <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2.5 py-0.5 font-mono text-[11px] text-white/60">
                {s.slideIndex + 1} / {s.slideCount}
              </div>
            </>
          ) : (
            <DeckGallery
              recent={recent}
              onOpenFile={openDeckAndWindow}
              onOpenRecent={(id) => openDeckAndWindow(undefined, id)}
              onForget={forget}
            />
          )}

          {s.toast ? <Toast kind={s.toast.kind} text={s.toast.text} /> : null}
        </div>

        <aside
          className="flex min-h-0 flex-col border-l border-line"
          style={{ width: `${LAYOUT.ASIDE_FRACTION * 100}%`, minWidth: LAYOUT.MIN_ASIDE_PX }}
        >
          {/* Старт и оба канала одной строкой: половина ширины под старт,
              по четверти под канал. Лампочка канала и его язык живут в
              одной кнопке — это один вопрос, а разнесённые точка и кнопка
              заставляли связывать их глазами. */}
          <div className="toolbar">
            <div className="flex gap-1">
              <button
                onClick={() => void (channels.listening ? channels.stopAll() : channels.startAll())}
                className={`btn flex-[2] truncate py-2 ${channels.listening ? 'btn-stop' : 'btn-go'}`}
                title={channels.listening ? t('hintStop') : t('hintListen')}
              >
                {channels.listening ? t('stopListening') : t('startListening')}
              </button>
              <ChannelChip
                label={t('me')}
                status={s.presenterStatus}
                mode={s.profile.presenterMode}
                langs={s.profile.presenterLangs}
                hint={t('hintMicLang')}
                onCycle={() => cycleChannel('presenter')}
              />
              <ChannelChip
                label={t('room')}
                status={s.audienceStatus}
                mode={s.profile.audienceMode}
                langs={s.profile.audienceLangs}
                hint={t('hintRoomLang')}
                onCycle={() => cycleChannel('audience')}
              />
            </div>

            {/* Вторая строка: слева язык чтения, справа время, расход и «⋯».
                Разными строками они занимали высоту дважды, а связаны не
                были — это просто всё, чем управляют не голосом. */}
            <div className="mt-1 flex items-center gap-2">
              {s.captions.visible ? (
                <ReadInPicker />
              ) : (
                <button onClick={() => runCommand('captions')} className="btn btn-alarm" title={t('hintCaptionsBack')}>
                  {t('captionsHidden')}
                </button>
              )}

              <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-dim">
                <span title={t('hintElapsed')}>{clock(elapsed)}</span>
                {geminiInUse ? <Spend used={used} /> : null}
              </span>

              <div className="relative">
                <button onClick={() => setMenu((v) => !v)} className="btn" title={t('menuHint')}>
                  ⋯
                </button>
                {menu ? (
                  <ControlMenu
                    onClose={() => setMenu(false)}
                    theme={theme}
                    uiLang={uiLang}
                    used={used}
                    geminiInUse={geminiInUse}
                    onOpenWizard={() => setWizard(true)}
                  />
                ) : null}
              </div>
            </div>
          </div>

          <ChatLog />
        </aside>
      </div>

      {/* Крупная строка. Высота фиксирована: если считать по содержимому,
          длинная фраза выталкивает сама себя за край окна. */}
      <CaptionFooter />
    </main>
  );
}

/** Расход считается локально по фактическим токенам из ответов Gemini,
 *  поэтому обновляется мгновенно и без обращений к биллингу. */
function Spend({ used }: { used: number }) {
  const share = quota.cap ? used / quota.cap : 0;
  return (
    <span
      className={share > 0.9 ? 'text-err' : share > 0.7 ? 'text-warn' : ''}
      title={`${used} of your ${quota.cap} request limit. Tokens: ${quota.inTokens} in, ${quota.outTokens} out.`}
    >
      {usd(quota.spentUsd())} · {used}/{quota.cap}
    </span>
  );
}

/**
 * Канал: лампочка состояния, чей он и на каком языке слушается.
 * Нажатие перебирает языки профиля и AUTO — если перебирать есть что.
 */
function ChannelChip({
  label,
  status,
  mode,
  langs,
  hint,
  onCycle,
}: {
  label: string;
  status: string;
  mode: LangMode;
  langs: Lang[];
  hint: string;
  onCycle: () => void;
}) {
  const fixed = modeCycle(langs).length < 2;
  return (
    <button onClick={onCycle} disabled={fixed} className="channel" title={hint}>
      <StatusDot status={status} />
      <span className="truncate text-[10px] uppercase text-dim">{label}</span>
      <span className="ml-auto font-mono text-xs font-bold">{modeLabel(mode)}</span>
    </button>
  );
}

function Toast({ kind, text }: { kind: 'info' | 'warn' | 'error'; text: string }) {
  const bg = kind === 'error' ? 'var(--err)' : kind === 'warn' ? 'var(--warn)' : 'rgb(0 0 0 / 0.78)';
  return (
    <div
      className="absolute inset-x-0 top-0 px-3 py-1.5 text-xs"
      style={{ background: bg, color: kind === 'info' ? 'var(--fg)' : 'var(--on-accent)' }}
    >
      {text}
    </div>
  );
}

