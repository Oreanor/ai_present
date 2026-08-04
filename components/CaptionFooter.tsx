'use client';

import { useShallow } from 'zustand/react/shallow';
import { LAYOUT } from '@/lib/constants';
import { pickText, subtitlePrefs } from '@/lib/profile';
import { useStore } from '@/lib/store';
import { useT } from '@/lib/ui-prefs';

/**
 * Полоса субтитров — то, ради чего окно и расшаривают.
 *
 * Две строки. Сверху мелко и прописными — распознанное как есть: по нему
 * видно, что распознавание живо, и слышно ли то, что вы сказали. Снизу
 * крупно — перевод на язык показа, ради которого зал сюда и смотрит.
 * Прописные набраны намеренно: они не спорят с крупной строкой за
 * внимание, потому что читаются как метка, а не как текст.
 *
 * Реплики зала жёлтые. Зритель должен с одного взгляда понимать, переводят
 * ему докладчика или коллегу из зала (§9), и цвет говорит это быстрее
 * любой подписи.
 *
 * Отдельный компонент не ради порядка, а ради скорости: промежуточный
 * результат распознавания меняется по нескольку раз в секунду, и пока
 * эта строка жила прямо в странице, вместе с ней перерисовывались слайд,
 * разметка и вся лента.
 */
export function CaptionFooter() {
  const t = useT();
  const { profile, entries, captionLine, partial } = useStore(
    useShallow((s) => ({
      profile: s.profile,
      entries: s.entries,
      captionLine: s.captionLine,
      partial: s.partial,
    })),
  );

  // После перезагрузки живой строки нет — падаем на последнюю запись
  // восстановленного лога, иначе полоса пустует до первой новой реплики.
  const finals = entries.filter((e) => e.isFinal);
  const last = finals[finals.length - 1];
  const big = captionLine?.text ?? (last && pickText(last.texts, subtitlePrefs(profile, last.speaker)));

  // Дублировать перевод оригиналом незачем: когда говорили уже на языке
  // показа, обе строки совпали бы.
  const heard = last && last.origText !== big ? last.origText : null;
  const fromRoom = (captionLine?.speaker ?? last?.speaker) === 'audience';

  return (
    <footer
      className="relative flex shrink-0 flex-col items-center justify-center gap-1 border-t border-line bg-panel px-10 py-3"
      style={{ height: LAYOUT.BAND_PX }}
    >
      <div className="absolute left-3 top-2 text-[10px] uppercase tracking-wide text-dim">
        {t('sectionSubtitles')}
      </div>

      <p className="max-w-[90%] truncate text-center text-[13px] uppercase tracking-wide text-dim">
        {partial ?? heard ?? ''}
      </p>
      <p
        className="line-clamp-2 text-center text-[34px] font-semibold leading-tight"
        style={{ textWrap: 'balance', color: fromRoom ? 'var(--warn)' : undefined }}
      >
        {big ?? <span className="text-[16px] font-normal text-dim">{t('nothingYet')}</span>}
      </p>
    </footer>
  );
}
