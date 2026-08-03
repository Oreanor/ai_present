'use client';

import type { Entry, LangMode, MeetingProfile } from '@/lib/types';
import { LANG_NAMES } from '@/lib/types';
import { modeLabel } from '@/lib/profile';

/**
 * Панель контроля качества (§10). Ведущий может не знать языка аудитории
 * и проверить субтитры не в состоянии в принципе. Без этой панели он узнает,
 * что распознавание понесло чушь, только по лицам в зале.
 *
 * Здесь же — текущий язык микрофона: и забытый пин, и дрейф автоопределения
 * проявляются в этом месте мгновенно.
 */
export function QualityPanel({
  entries,
  profile,
  onCycleLang,
}: {
  entries: Entry[];
  profile: MeetingProfile;
  onCycleLang: () => void;
}) {
  const last = [...entries].reverse().find((e) => e.speaker === 'presenter' && e.isFinal);
  const caption = last?.texts[profile.captionLang];

  return (
    <div className="border-b border-line bg-black/25 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-dim">What the audience sees</span>
        <button
          onClick={onCycleLang}
          disabled={profile.presenterMode.kind !== 'pin'}
          className="ml-auto rounded border border-line px-2 py-0.5 text-[11px] font-bold disabled:opacity-50"
          title={profile.presenterMode.kind === 'pin' ? 'Press L to switch' : 'Auto-detect is on'}
        >
          MIC {modeLabel(profile.presenterMode)}
        </button>
      </div>

      {last ? (
        <>
          <p className="truncate text-[12px] text-dim" title={last.origText}>
            {last.origText}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[15px] font-semibold leading-snug" title={caption ?? ''}>
            {caption ?? <span className="text-dim">translating…</span>}
          </p>
        </>
      ) : (
        <p className="text-[12px] text-dim">
          Nothing yet. Captions will be shown in {LANG_NAMES[profile.captionLang]}.
        </p>
      )}

      <PinHint mode={profile.presenterMode} />
    </div>
  );
}

function PinHint({ mode }: { mode: LangMode }) {
  if (mode.kind !== 'pin') return null;
  return (
    <p className="mt-1 text-[10px] text-dim">
      Pinned to {LANG_NAMES[mode.current]} — press <b className="text-fg">L</b> before switching language.
    </p>
  );
}
