'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Entry, Lang, MeetingProfile } from '@/lib/types';
import { LANG_NAMES } from '@/lib/types';

/**
 * Лог (§10). Каждая стенограмма — ПОЛНАЯ запись всей встречи: все реплики
 * подряд, обеих сторон, хронологически, целиком на одном языке.
 *
 * Две раскладки, выбор по ширине окна:
 *   чередование — основной режим при одном мониторе (Control ≈480 px);
 *   две колонки — при ширине > 700 px.
 * Обе читают одни и те же данные и отличаются только вёрсткой.
 */
const TWO_COLUMN_MIN = 700;

export function LogView({
  entries,
  profile,
  query,
  onToggleFlag,
  onEdit,
}: {
  entries: Entry[];
  profile: MeetingProfile;
  query: string;
  onToggleFlag: (id: string) => void;
  onEdit: (id: string, lang: Lang | 'orig', text: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const [twoCol, setTwoCol] = useState(false);
  const [forced, setForced] = useState<'auto' | 'rows' | 'cols'>('auto');

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTwoCol(el.clientWidth >= TWO_COLUMN_MIN));
    ro.observe(el);
    setTwoCol(el.clientWidth >= TWO_COLUMN_MIN);
    return () => ro.disconnect();
  }, []);

  // Автопрокрутка отключается при ручном скролле — иначе невозможно
  // перечитать вопрос, заданный минуту назад.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [entries, stick]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const [a, b] = profile.transcriptLangs;
  const q = query.trim().toLowerCase();
  const visible = q
    ? entries.filter(
        (e) =>
          e.origText.toLowerCase().includes(q) ||
          Object.values(e.texts).some((t) => t?.toLowerCase().includes(q)),
      )
    : entries;

  const useCols = forced === 'auto' ? twoCol : forced === 'cols';

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px] text-dim">
        <span className="font-semibold uppercase tracking-wide">{LANG_NAMES[a]}</span>
        <span className="opacity-40">·</span>
        <span className="font-semibold uppercase tracking-wide">{LANG_NAMES[b]}</span>
        <span className="ml-auto flex gap-1">
          {(['auto', 'rows', 'cols'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setForced(m)}
              className={`rounded px-1.5 py-0.5 ${forced === m ? 'bg-line text-fg' : ''}`}
            >
              {m}
            </button>
          ))}
        </span>
      </div>

      <div ref={boxRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {visible.length === 0 ? (
          <p className="py-8 text-center text-xs text-dim">
            {entries.length ? 'Nothing matches the search.' : 'No speech yet.'}
          </p>
        ) : null}

        {visible.map((e) => (
          <Row
            key={e.id}
            entry={e}
            langs={[a, b]}
            twoCol={useCols}
            onToggleFlag={onToggleFlag}
            onEdit={onEdit}
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
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-black shadow-lg"
        >
          ↓ Latest
        </button>
      ) : null}
    </div>
  );
}

function Row({
  entry,
  langs,
  twoCol,
  onToggleFlag,
  onEdit,
}: {
  entry: Entry;
  langs: [Lang, Lang];
  twoCol: boolean;
  onToggleFlag: (id: string) => void;
  onEdit: (id: string, lang: Lang | 'orig', text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const mine = entry.speaker === 'presenter';
  // Оригинала нет ни в одной колонке, если реплика на третьем языке —
  // тогда он доступен раскрытием строки (§10).
  const origHidden = !langs.includes(entry.origLang);

  const cell = (lang: Lang) => {
    const text = entry.texts[lang];
    const isOrig = entry.origLang === lang;
    return (
      <div
        className="min-w-0 flex-1"
        onDoubleClick={() => {
          const next = prompt(`Edit ${LANG_NAMES[lang]}`, text ?? '');
          if (next !== null) onEdit(entry.id, lang, next);
        }}
      >
        {text ? (
          <span className={isOrig ? '' : 'opacity-70'}>
            {isOrig ? <span className="mr-1 text-ok">•</span> : null}
            {text}
          </span>
        ) : (
          // Плейсхолдер, а не сдвиг строк: перевод ещё едет.
          <span className="inline-block h-3 w-16 animate-pulse rounded bg-line" />
        )}
      </div>
    );
  };

  return (
    <div
      className={`group mb-1.5 rounded-md border-l-2 px-2 py-1.5 text-[13px] leading-snug ${
        mine ? 'border-accent bg-white/[0.02]' : 'border-warn bg-white/[0.04]'
      } ${entry.isFinal ? '' : 'opacity-60'}`}
    >
      <div className="mb-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-dim">
        <span>{mine ? 'me' : 'audience'}</span>
        <span className="opacity-50">{entry.origLang}</span>
        <span className="opacity-50">slide {entry.slideIndex + 1}</span>
        {entry.edited ? <span className="opacity-50">edited</span> : null}
        <button
          onClick={() => onToggleFlag(entry.id)}
          className={`ml-auto ${entry.flagged ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'}`}
          title="Flag for follow-up"
        >
          🔖
        </button>
        {origHidden ? (
          <button onClick={() => setOpen((v) => !v)} className="opacity-60" title="Show original">
            {open ? '▾' : '▸'}
          </button>
        ) : null}
      </div>

      {twoCol ? (
        <div className="flex gap-3">
          {cell(langs[0])}
          <div className="w-px shrink-0 bg-line" />
          {cell(langs[1])}
        </div>
      ) : (
        <div className="space-y-0.5">
          {cell(langs[0])}
          {cell(langs[1])}
        </div>
      )}

      {origHidden && open ? (
        <div
          className="mt-1 border-t border-line pt-1 text-[12px] text-dim"
          onDoubleClick={() => {
            const next = prompt('Edit original', entry.origText);
            if (next !== null) onEdit(entry.id, 'orig', next);
          }}
        >
          <span className="mr-1 uppercase">{entry.origLang}</span>
          {entry.origText}
        </div>
      ) : null}
    </div>
  );
}
