'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import type { Entry, Lang, MeetingProfile } from '@/lib/types';
import { LANG_NAMES } from '@/lib/types';

/**
 * Лог как переписка (§10). Одна лента, пузыри, свои реплики справа —
 * так же, как в любом мессенджере.
 *
 * Показывается ОДИН язык — тот, на котором ведущий думает. Две колонки
 * рядом требуют читать таблицу, а во время выступления читать таблицу
 * некогда. Вторая версия и оригинал раскрываются по клику на пузырь:
 * они нужны редко, но когда нужны — нужны точно.
 *
 * Обе стенограммы при этом ведутся полностью и целиком уходят в экспорт.
 * Упрощён показ, а не данные.
 */
export function ChatLog({
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
  const [open, setOpen] = useState<string | null>(null);

  const [mine, theirs] = profile.transcriptLangs;

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [entries, stick]);

  const q = query.trim().toLowerCase();
  const visible = q
    ? entries.filter(
        (e) => e.origText.toLowerCase().includes(q) || Object.values(e.texts).some((t) => t?.toLowerCase().includes(q)),
      )
    : entries;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={boxRef}
        onScroll={() => {
          const el = boxRef.current;
          if (el) setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3"
      >
        {visible.length === 0 ? (
          <p className="pt-10 text-center text-xs text-dim">
            {entries.length ? 'Nothing matches.' : 'Nothing said yet.'}
          </p>
        ) : null}

        {visible.map((e) => {
          const isMine = e.speaker === 'presenter';
          const main = e.texts[mine] ?? e.origText;
          const other = e.texts[theirs];
          const expanded = open === e.id;

          return (
            <div key={e.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[88%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                <button
                  onClick={() => setOpen(expanded ? null : e.id)}
                  className={`rounded-2xl px-3 py-2 text-left text-[14px] leading-snug transition-colors ${
                    isMine
                      ? 'rounded-br-md bg-accent/18 text-fg hover:bg-accent/25'
                      : 'rounded-bl-md bg-white/[0.07] text-fg hover:bg-white/[0.11]'
                  }`}
                  title="Click to see the other language and the original"
                >
                  {main}
                </button>

                <div className="mt-0.5 flex items-center gap-1.5 px-1 text-[10px] text-dim">
                  <span>{isMine ? 'me' : 'room'}</span>
                  <span className="opacity-50">·</span>
                  <span>slide {e.slideIndex + 1}</span>
                  {e.origLang !== mine ? (
                    <>
                      <span className="opacity-50">·</span>
                      <span className="uppercase">said in {e.origLang}</span>
                    </>
                  ) : null}
                  <button
                    onClick={() => onToggleFlag(e.id)}
                    className={e.flagged ? 'opacity-100' : 'opacity-30 hover:opacity-80'}
                    title="Flag for follow-up (B)"
                  >
                    🔖
                  </button>
                </div>

                {expanded ? (
                  <div
                    className={`mt-1 w-full rounded-lg border border-line bg-black/40 px-2.5 py-2 text-[12px] ${
                      isMine ? 'text-right' : ''
                    }`}
                  >
                    <p className="text-dim">
                      <span className="mr-1 uppercase opacity-60">{theirs}</span>
                      {other ?? '—'}
                    </p>
                    {e.origLang !== mine && e.origLang !== theirs ? (
                      <p className="mt-1 text-dim">
                        <span className="mr-1 uppercase opacity-60">{e.origLang}</span>
                        {e.origText}
                      </p>
                    ) : null}
                    <button
                      onClick={() => {
                        const next = prompt(`Fix the ${LANG_NAMES[mine]} text`, main);
                        if (next !== null) onEdit(e.id, mine, next);
                      }}
                      className="mt-1.5 rounded border border-line px-1.5 py-0.5 text-[11px] text-dim hover:text-fg"
                    >
                      Fix text
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
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
