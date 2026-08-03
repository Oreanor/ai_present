'use client';

import { useEffect, useRef, useState } from 'react';
import type { CaptionSettings, Speaker } from '@/lib/types';

/**
 * Полоса субтитров (§9). Показывает ВСЕГДА и только captionLang — сюда
 * приходит уже готовая строка, компонент языков не знает.
 *
 * Ведёт себя как настоящие субтитры, а не как бегущая строка распознавания:
 *
 *   — текст выдаётся ЦЕЛЫМИ карточками по одной-две строки, а не дописывается
 *     по слову. Дописывание по слову физически невозможно читать: глаз ловит
 *     движение вместо смысла;
 *   — длинная фраза не обрезается, а разбивается на несколько карточек,
 *     которые проходят по очереди. Обрезание молча теряет конец фразы;
 *   — каждая карточка висит время, пропорциональное длине, но не меньше
 *     минимума — иначе при быстрой речи субтитр мелькает;
 *   — когда речь прекратилась, полоса ГАСНЕТ. Её задача — дать следить за
 *     речью без напряжения, а не висеть над слайдом весь доклад. Связный
 *     текст накапливается в колонке.
 *
 * Цена — задержка в несколько секунд на длинных фразах. Это осознанный
 * обмен: субтитр, который можно прочитать, полезнее субтитра, который
 * появился раньше.
 *
 * Никаких rAF: перекрытое окно Chrome их не обслуживает, а Teams продолжает
 * транслировать содержимое зрителям.
 */

/** Примерно столько влезает в две строки крупным кеглем. */
const MAX_CHARS = 84;
/** Меньше этого карточка мелькает и не читается. */
const MIN_DWELL_MS = 1400;
/** Скорость чтения: примерно 15 знаков в секунду. */
const MS_PER_CHAR = 65;
/** Пауза в речи, после которой полоса гаснет. */
const CLEAR_AFTER_MS = 7000;

type Line = { text: string; final: boolean; speaker: Speaker };
type Card = { text: string; speaker: Speaker; key: string };

/**
 * Режет фразу на карточки субтитрового размера. Приоритет разрыва:
 * конец предложения → запятая → пробел. Разрыв посреди слова недопустим.
 */
export function splitForSubtitles(text: string, max = MAX_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];

  const out: string[] = [];
  let rest = clean;

  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    const at =
      lastIndexOfAny(window, ['. ', '! ', '? ', '… ']) ??
      lastIndexOfAny(window, [', ', '; ', ': ', ' — ']) ??
      window.lastIndexOf(' ');

    // Слово длиннее строки — режем жёстко, иначе зациклимся.
    const cut = at && at > max * 0.4 ? at : max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function lastIndexOfAny(s: string, needles: string[]): number | null {
  let best = -1;
  for (const n of needles) {
    const i = s.lastIndexOf(n);
    if (i > best) best = i + n.length - 1;
  }
  return best > 0 ? best : null;
}

export function CaptionBand({
  line,
  settings,
  height,
}: {
  line: Line | null;
  settings: CaptionSettings;
  height: number;
}) {
  const [card, setCard] = useState<Card | null>(null);
  const queue = useRef<Card[]>([]);
  const lastFinalId = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // В полосу идут ТОЛЬКО законченные фразы. Промежуточные результаты
  // не показываются вообще: дописывающийся по слову текст невозможно
  // читать — глаз ловит движение вместо смысла, и субтитр из помощи
  // превращается в помеху. Ждём, пока фраза договорена.
  //
  // Живой признак того, что распознавание работает, ведущий видит
  // у себя в Control (§10), а не зрители на экране.
  useEffect(() => {
    if (!line?.text || !line.final) return;

    const id = `${line.speaker}:${line.text}`;
    if (id === lastFinalId.current) return;
    lastFinalId.current = id;

    queue.current.push(
      ...splitForSubtitles(line.text).map((text, i) => ({ text, speaker: line.speaker, key: `${id}#${i}` })),
    );
    pump();
  }, [line]); // eslint-disable-line react-hooks/exhaustive-deps

  function pump() {
    if (timer.current) return;
    const step = () => {
      timer.current = null;
      const next = queue.current.shift();
      if (!next) {
        // Очередь пуста — гасим полосу после паузы.
        timer.current = setTimeout(() => {
          timer.current = null;
          if (queue.current.length === 0) setCard(null);
        }, CLEAR_AFTER_MS);
        return;
      }
      setCard(next);
      const dwell = Math.max(MIN_DWELL_MS, next.text.length * MS_PER_CHAR);
      timer.current = setTimeout(step, dwell);
    };
    step();
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // Клавиша H гасит полосу мгновенно и сбрасывает очередь: если
  // распознавание понесло чушь, доигрывать её до конца незачем.
  useEffect(() => {
    if (!settings.visible) {
      queue.current = [];
      setCard(null);
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    }
  }, [settings.visible]);

  if (!settings.visible || !card) return null;

  const fromAudience = card.speaker === 'audience';

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center"
      style={{ height, background: settings.background }}
    >
      <div
        key={card.key}
        className="max-w-[88%] text-center"
        style={{
          // Реплики зала оформлены иначе: зритель должен с одного взгляда
          // понимать, переводят ему докладчика или коллегу из зала (§9).
          color: fromAudience ? '#cfe3ff' : settings.color,
          fontSize: settings.fontSize,
          lineHeight: 1.24,
          fontWeight: 600,
          textShadow: '0 2px 14px rgba(0,0,0,0.9)',
          textWrap: 'balance',
        }}
      >
        {fromAudience ? <span style={{ opacity: 0.7, marginRight: '0.4em' }}>❝</span> : null}
        {card.text}
      </div>
    </div>
  );
}
