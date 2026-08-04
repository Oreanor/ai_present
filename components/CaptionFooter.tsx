'use client';

import { useShallow } from 'zustand/react/shallow';
import { LAYOUT } from '@/lib/constants';
import { shownLang, useStore } from '@/lib/store';
import { useT } from '@/lib/ui-prefs';

/**
 * Полоса субтитров — то, ради чего окно и расшаривают.
 *
 * Здесь только субтитр и ничего больше. Мелкая строка с распознанным как
 * есть отсюда убрана: полосу читает зал, и вторая строка мельче основной
 * заставляет выбирать, что читать. Признак работы распознавания и
 * оригинал реплики видит ведущий — в панели и в ленте.
 *
 * Отдельный компонент не ради порядка, а ради скорости: промежуточный
 * результат распознавания меняется по нескольку раз в секунду, и пока
 * эта строка жила прямо в странице, вместе с ней перерисовывались слайд,
 * разметка и вся лента.
 */
export function CaptionFooter() {
  const t = useT();
  const { profile, viewLang, entries, captionLine } = useStore(
    useShallow((s) => ({
      profile: s.profile,
      viewLang: s.viewLang,
      entries: s.entries,
      captionLine: s.captionLine,
    })),
  );

  const view = shownLang({ viewLang, profile });

  // После перезагрузки живой строки нет — падаем на последнюю запись
  // восстановленного лога, иначе полоса пустует до первой новой реплики.
  const finals = entries.filter((e) => e.isFinal);
  const big = captionLine?.text ?? finals[finals.length - 1]?.texts[view];

  return (
    <footer
      className="relative flex shrink-0 items-center justify-center border-t border-line bg-panel px-10 py-3"
      style={{ height: LAYOUT.BAND_PX }}
    >
      <div className="absolute left-3 top-2 text-[10px] uppercase tracking-wide text-dim">
        {t('sectionSubtitles')}
      </div>
      <p className="line-clamp-2 text-center text-[34px] font-semibold leading-tight" style={{ textWrap: 'balance' }}>
        {big ?? <span className="text-[16px] font-normal text-dim">{t('nothingYet')}</span>}
      </p>
    </footer>
  );
}
