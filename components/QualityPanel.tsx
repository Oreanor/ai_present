'use client';

import type { Entry, MeetingProfile } from '@/lib/types';
import { LANG_NAMES } from '@/lib/types';
import { modeLabel } from '@/lib/profile';

/**
 * Панель ведущего (§10). Показывает то, что важно прямо сейчас, и
 * переключается сама по тому, кто говорил последним.
 *
 * Два разных назначения, и путать их нельзя:
 *
 *   ВОПРОС ИЗ ЗАЛА — крупно, на языке ведущего. Он мог не расслышать,
 *   мог не знать языка вопроса, и читать его в логе тринадцатым кеглем
 *   посреди Q&A невозможно. Это его единственный шанс понять вопрос.
 *
 *   СВОЯ РЕЧЬ — пара «что я сказал → что увидели зрители». Ведущий может
 *   не знать языка аудитории и проверить субтитры не в состоянии в
 *   принципе. Без этой пары он узнает, что распознавание понесло чушь,
 *   только по лицам в зале.
 *
 * Здесь же живёт промежуточный результат: в расшаренную полосу он не идёт
 * (§9), но ведущему нужен признак, что распознавание вообще слышит.
 */
export function QualityPanel({
  entries,
  profile,
  partial,
  onCycleLang,
}: {
  entries: Entry[];
  profile: MeetingProfile;
  partial: string | null;
  onCycleLang: () => void;
}) {
  const finals = entries.filter((e) => e.isFinal);
  const last = finals[finals.length - 1];
  const myLang = profile.transcriptLangs[0];

  const askedByRoom = last?.speaker === 'audience';
  const lastMine = [...finals].reverse().find((e) => e.speaker === 'presenter');

  return (
    <div className="border-b border-line bg-black/25 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-dim">
          {askedByRoom ? 'Question from the room' : 'What the audience sees'}
        </span>
        <button
          onClick={onCycleLang}
          disabled={profile.presenterMode.kind !== 'pin'}
          className="ml-auto rounded border border-line px-2 py-0.5 text-[11px] font-bold disabled:opacity-50"
          title={profile.presenterMode.kind === 'pin' ? 'Press L to switch' : 'Auto-detect is on'}
        >
          MIC {modeLabel(profile.presenterMode)}
        </button>
      </div>

      {askedByRoom ? (
        // Вопрос — крупно и на своём языке. Оригинал мельче, для сверки.
        <>
          <p className="text-[19px] font-semibold leading-snug">
            {last.texts[myLang] ?? <span className="text-dim">translating…</span>}
          </p>
          {last.origLang !== myLang && last.origText ? (
            <p className="mt-1 truncate text-[12px] text-dim" title={last.origText}>
              <span className="mr-1 uppercase">{last.origLang}</span>
              {last.origText}
            </p>
          ) : null}
        </>
      ) : lastMine ? (
        <>
          <p className="truncate text-[12px] text-dim" title={lastMine.origText}>
            {lastMine.origText}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug">
            {lastMine.texts[profile.captionLang] ?? <span className="text-dim">translating…</span>}
          </p>
        </>
      ) : (
        <p className="text-[12px] text-dim">
          Nothing yet. Captions will be shown in {LANG_NAMES[profile.captionLang]}.
        </p>
      )}

      <div className="mt-1 flex items-baseline gap-2">
        {/* Промежуточный результат — только здесь. Зрителям он не нужен,
            а ведущему без него непонятно, слышит его микрофон или нет. */}
        {partial ? (
          <p className="min-w-0 flex-1 truncate text-[11px] italic text-accent/70" title={partial}>
            {partial}
          </p>
        ) : (
          <p className="min-w-0 flex-1 text-[10px] text-dim">
            {profile.presenterMode.kind === 'pin' ? (
              <>
                Pinned to {LANG_NAMES[profile.presenterMode.current]} — press{' '}
                <b className="text-fg">L</b> before switching language.
              </>
            ) : (
              'Language is detected automatically.'
            )}
          </p>
        )}
      </div>
    </div>
  );
}
