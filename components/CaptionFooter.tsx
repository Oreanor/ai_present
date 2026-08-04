'use client';

import { useShallow } from 'zustand/react/shallow';
import { LAYOUT } from '@/lib/constants';
import { shownLang, useStore } from '@/lib/store';
import { useT } from '@/lib/ui-prefs';
import { StatusDot } from './StatusDot';

/**
 * Крупная строка внизу — то, ради чего окно и расшаривают.
 *
 * Отдельный компонент не ради порядка, а ради скорости: промежуточный
 * результат распознавания меняется по нескольку раз в секунду, и пока
 * эта строка жила прямо в странице, вместе с ней перерисовывались слайд,
 * разметка и вся лента.
 */
export function CaptionFooter() {
  const t = useT();
  const { profile, viewLang, entries, captionLine, partial, presenterStatus, audienceStatus } = useStore(
    useShallow((s) => ({
      profile: s.profile,
      viewLang: s.viewLang,
      entries: s.entries,
      captionLine: s.captionLine,
      partial: s.partial,
      presenterStatus: s.presenterStatus,
      audienceStatus: s.audienceStatus,
    })),
  );

  const view = shownLang({ viewLang, profile });
  const finals = entries.filter((e) => e.isFinal);
  const last = finals[finals.length - 1];

  // После перезагрузки живой строки нет — падаем на последнюю запись
  // восстановленного лога, иначе полоса пустует до первой новой реплики.
  const big = captionLine?.text ?? last?.texts[view];

  // Сверху мелко — что распозналось как есть. Когда говорили уже на языке
  // показа, перевода нет и дублировать нечего.
  const heard = last && last.origText !== big ? last.origText : null;

  return (
    <footer
      className="relative flex shrink-0 flex-col items-center justify-center gap-1.5 border-t border-line bg-panel px-10 py-3"
      style={{ height: LAYOUT.BAND_PX }}
    >
      {/* Подпись нужна залу: без неё крупная строка внизу и лента справа
          выглядят двумя лентами одного и того же. Стоит в углу и тем же
          набором, что заголовки в остальном окне. */}
      <div className="absolute left-3 top-2 text-[10px] uppercase tracking-wide text-dim">
        {t('sectionSubtitles')}
      </div>
      <div className="flex max-w-[90%] items-center gap-2 text-[13px] text-dim">
        <StatusDot status={last?.speaker === 'audience' ? audienceStatus : presenterStatus} />
        <span className="truncate">{partial ?? heard ?? ''}</span>
      </div>
      <p className="line-clamp-2 text-center text-[34px] font-semibold leading-tight" style={{ textWrap: 'balance' }}>
        {big ?? <span className="text-[16px] font-normal text-dim">{t('nothingYet')}</span>}
      </p>
    </footer>
  );
}
