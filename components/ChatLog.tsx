'use client';

import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { shownLang, useStore } from '@/lib/store';
import { transcriptLangs } from '@/lib/profile';
import { LANG_NAMES, type Entry, type Lang } from '@/lib/types';
import { useT } from '@/lib/ui-prefs';

/**
 * Лог как переписка (§10). Одна лента, пузыри, свои реплики справа —
 * так же, как в любом мессенджере.
 *
 * Показывается ОДИН язык, по умолчанию язык аудитории: лог отдают
 * участникам встречи, и читать его будут прежде всего они. Две колонки
 * рядом требуют читать таблицу, а во время выступления читать таблицу
 * некогда. Вторая версия и оригинал раскрываются кликом по пузырю.
 *
 * Обе стенограммы при этом ведутся полностью и целиком уходят в экспорт.
 * Упрощён показ, а не данные.
 */
export function ChatLog() {
  // Поимённая подписка: промежуточный текст распознавания меняется по
  // нескольку раз в секунду, и подписка на весь стор перерисовывала бы
  // всю ленту на каждое слово.
  const { entries, profile, viewLang } = useStore(
    useShallow((s) => ({
      entries: s.entries,
      profile: s.profile,
      viewLang: s.viewLang,
    })),
  );
  const t = useT();

  const boxRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const toggleOpen = useCallback((id: string) => setOpen((cur) => (cur === id ? null : id)), []);

  const kept = transcriptLangs(profile);
  const shown = shownLang({ viewLang, profile });
  const other = kept.find((l) => l !== shown) ?? kept[0];

  // Автопрокрутка отключается при ручном скролле — иначе невозможно
  // перечитать вопрос, заданный минуту назад.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [entries, stick]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pt-2 text-[10px] uppercase tracking-wide text-dim">{t('sectionLog')}</div>
      <div
        ref={boxRef}
        onScroll={() => {
          const el = boxRef.current;
          if (el) setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3"
      >
        {entries.length === 0 ? <p className="pt-10 text-center text-xs text-dim">{t('nothingInLog')}</p> : null}

        {entries.map((e) => (
          <Bubble
            key={e.id}
            entry={e}
            shown={shown}
            other={other}
            expanded={open === e.id}
            onToggle={toggleOpen}
          />
        ))}
      </div>

      {!stick ? (
        <button
          onClick={() => {
            setStick(true);
            const el = boxRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
          className="btn btn-primary btn-sm absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-lg"
        >
          {t('latest')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Пузырь мемоизирован, и пропсы у него только данные: обработчики,
 * созданные заново на каждый рендер, свели бы мемоизацию к нулю. Правка
 * и метка берутся прямо из стора — они не зависят от родителя.
 */
const Bubble = memo(function Bubble({
  entry,
  shown,
  other,
  expanded,
  onToggle,
}: {
  entry: Entry;
  shown: Lang;
  other: Lang;
  expanded: boolean;
  onToggle: (id: string) => void;
}) {
  const t = useT();
  const mine = entry.speaker === 'presenter';
  const main = entry.texts[shown] ?? entry.origText;

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'} max-w-[88%]`}>
        <button onClick={() => onToggle(entry.id)} className={`bubble ${mine ? 'bubble-mine' : 'bubble-room'}`} title={t('clickForOther')}>
          {main}
        </button>

        <div className="bubble-meta">
          <span>{mine ? t('me') : t('room')}</span>
          <span className="opacity-50">·</span>
          <span>
            {t('slide')} {entry.slideIndex + 1}
          </span>
          {entry.origLang !== shown ? (
            <>
              <span className="opacity-50">·</span>
              <span className="uppercase">
                {t('saidIn')} {entry.origLang}
              </span>
            </>
          ) : null}
          <button
            onClick={() => useStore.getState().toggleFlag(entry.id)}
            className={entry.flagged ? 'opacity-100' : 'opacity-30 hover:opacity-80'}
            title={t('flagForFollowUp')}
          >
            🔖
          </button>
        </div>

        {expanded ? (
          <div className={`mt-1 w-full rounded-lg border border-line bg-black/20 px-2.5 py-2 text-[12px] ${mine ? 'text-right' : ''}`}>
            <p className="text-dim">
              <span className="mr-1 uppercase opacity-60">{other}</span>
              {entry.texts[other] ?? '—'}
            </p>
            {entry.origLang !== shown && entry.origLang !== other ? (
              <p className="mt-1 text-dim">
                <span className="mr-1 uppercase opacity-60">{entry.origLang}</span>
                {entry.origText}
              </p>
            ) : null}
            <button
              onClick={() => {
                const next = prompt(`${t('fixTextPrompt')} (${LANG_NAMES[shown]})`, main);
                if (next !== null) useStore.getState().editEntry(entry.id, shown, next);
              }}
              className="btn btn-sm mt-1.5"
            >
              {t('fixText')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
});
