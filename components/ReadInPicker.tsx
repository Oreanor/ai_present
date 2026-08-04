'use client';

import { useShallow } from 'zustand/react/shallow';
import { transcriptLangs } from '@/lib/profile';
import { shownLang, useStore } from '@/lib/store';
import { ALL_LANGS, type Lang } from '@/lib/types';
import { useT } from '@/lib/ui-prefs';

/**
 * На каком языке читают ленту и субтитр.
 *
 * Живёт в панели, а не шапкой над лентой: это такой же орган управления,
 * как старт и каналы, и отдельная полоса ради трёх кнопок отбирала у
 * переписки высоту.
 *
 * Два языка стенограмм хранятся всегда, поэтому переключение между ними
 * мгновенно. Третий догоняется переводом всей ленты на устройстве —
 * отсюда счётчик прогресса и блокировка на время перевода.
 */
export function ReadInPicker() {
  const { profile, viewLang, deckLangs, translating, setViewLang } = useStore(
    useShallow((s) => ({
      profile: s.profile,
      viewLang: s.viewLang,
      deckLangs: s.deckLangs,
      translating: s.translating,
      setViewLang: s.setViewLang,
    })),
  );
  const t = useT();

  const kept = transcriptLangs(profile);
  const shown = shownLang({ viewLang, profile });
  // Точка означает, что у этого языка есть своя версия слайдов. Без неё
  // переключение меняет только текст, а слайд остаётся основным — и
  // понять, почему он не сменился, было неоткуда.
  const ownSlides = (l: Lang) => deckLangs.length > 1 && deckLangs.includes(l);

  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="mr-0.5 text-[10px] uppercase tracking-wide text-dim">{t('readIn')}</span>
      {ALL_LANGS.map((l) => (
        <button
          key={l}
          onClick={() => void setViewLang(l)}
          disabled={!!translating}
          className={`btn btn-sm font-semibold uppercase ${shown === l ? 'btn-on' : ''}`}
          title={`${kept.includes(l) ? t('hintKeptIn') : t('hintTranslateAll')}${ownSlides(l) ? ` · ${t('hasOwnSlides')}` : ''}`}
        >
          {l}
          {ownSlides(l) ? <span className="ml-1 align-middle text-[7px] opacity-70">●</span> : null}
        </button>
      ))}
      {translating ? (
        <span className="font-mono text-[10px] text-warn">
          {translating.done}/{translating.total}
        </span>
      ) : null}
    </div>
  );
}
