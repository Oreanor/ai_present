'use client';

import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CAPTIONS, LAYOUT } from '@/lib/constants';
import { captionLangOf, pickText, subtitlePrefs } from '@/lib/profile';
import { useStore } from '@/lib/store';
import { SAMPLE_SUBTITLE } from '@/lib/types';
import { useT } from '@/lib/ui-prefs';

/**
 * Полоса субтитров — то, ради чего окно и расшаривают.
 *
 * Две строки. Сверху мелко и прописными — распознанное как есть: по нему
 * и ведущий, и зал видят, верно ли расслышана фраза. Снизу крупно —
 * перевод, обращённый к другой стороне: сказанное ведущим зал читает на
 * своём языке, вопрос из зала ведущий читает на своём.
 *
 * Реплики зала жёлтые. Зритель должен с одного взгляда понимать, переводят
 * ему докладчика или коллегу из зала (§9), и цвет говорит это быстрее
 * любой подписи.
 *
 * Высота считается из кегля, а не задана числом: размер меняют под зал,
 * и полоса обязана расти вместе с ним. По содержимому её считать нельзя —
 * длинная фраза вытолкнет сама себя за край окна.
 *
 * Отдельный компонент не ради порядка, а ради скорости: промежуточный
 * результат распознавания меняется по нескольку раз в секунду, и пока
 * эта строка жила прямо в странице, вместе с ней перерисовывались слайд,
 * разметка и вся лента.
 */
export function CaptionFooter() {
  const t = useT();
  const { profile, entries, captionLine, partial, captions, setCaptions } = useStore(
    useShallow((s) => ({
      profile: s.profile,
      entries: s.entries,
      captionLine: s.captionLine,
      partial: s.partial,
      captions: s.captions,
      setCaptions: s.setCaptions,
    })),
  );

  // Образец, по которому подбирают размер. Живёт в компоненте и гаснет сам:
  // в общий поток субтитров ему нельзя, он попал бы в лог и к зрителям
  // как настоящая реплика.
  const [sample, setSample] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const resize = (delta: number) => {
    const next = Math.min(CAPTIONS.FONT_MAX, Math.max(CAPTIONS.FONT_MIN, captions.fontSize + delta));
    setCaptions({ fontSize: next });
    setSample(SAMPLE_SUBTITLE[captionLangOf(profile)]);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSample(null), CAPTIONS.SAMPLE_MS);
  };

  // После перезагрузки живой строки нет — падаем на последнюю запись
  // восстановленного лога, иначе полоса пустует до первой новой реплики.
  const finals = entries.filter((e) => e.isFinal);
  const last = finals[finals.length - 1];
  const big = sample ?? captionLine?.text ?? (last && pickText(last.texts, subtitlePrefs(profile, last.speaker)));

  // Дублировать перевод оригиналом незачем: когда говорили уже на языке
  // показа, обе строки совпали бы.
  const heard = last && last.origText !== big ? last.origText : null;
  const fromRoom = !sample && (captionLine?.speaker ?? last?.speaker) === 'audience';

  return (
    <footer
      className="relative flex shrink-0 flex-col items-center justify-center gap-1 border-t border-line bg-panel px-10 py-3"
      style={{ height: Math.round(captions.fontSize * 2.1) + LAYOUT.BAND_CHROME_PX }}
    >
      <div className="absolute left-3 top-2 text-[10px] uppercase tracking-wide text-dim">
        {t('sectionSubtitles')}
      </div>

      {/* Столбиком у НИЖНЕГО края: полоса растёт вместе с кеглем, её верх
          при этом уезжает вверх, и кнопки, привязанные к верху, прыгали бы
          из-под курсора при каждом нажатии. Низ стоит на месте.

          Нажатие показывает образец на языке зала: без него размер
          выставляют вслепую и проверяют на первой живой реплике. */}
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        <button onClick={() => resize(CAPTIONS.FONT_STEP)} title={t('bigger')} className="btn btn-sm w-7">
          +
        </button>
        <button onClick={() => resize(-CAPTIONS.FONT_STEP)} title={t('smaller')} className="btn btn-sm w-7">
          −
        </button>
      </div>

      <p className="max-w-[90%] truncate text-center text-[13px] uppercase tracking-wide text-dim">
        {sample ? '' : (partial ?? heard ?? '')}
      </p>
      <p
        className="line-clamp-2 text-center font-semibold leading-tight"
        style={{
          fontSize: captions.fontSize,
          textWrap: 'balance',
          color: fromRoom ? 'var(--warn)' : undefined,
          opacity: sample ? 0.75 : 1,
        }}
      >
        {big ?? <span className="text-[16px] font-normal text-dim">{t('nothingYet')}</span>}
      </p>
    </footer>
  );
}
