'use client';

import { useEffect, useRef, useState } from 'react';
import { CAPTIONS } from '@/lib/constants';
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


type Line = {
  text: string;
  final: boolean;
  speaker: Speaker;
  /** Распознанное как есть. Показывается мелко над переводом — по нему и
   *  ведущий, и зал видят, верно ли расслышана фраза. */
  orig?: string;
};
type Card = { text: string; speaker: Speaker; orig?: string; key: string };

/**
 * Режет фразу на карточки субтитрового размера. Приоритет разрыва:
 * конец предложения → запятая → пробел. Разрыв посреди слова недопустим.
 */
export function splitForSubtitles(text: string, max = CAPTIONS.MAX_CHARS): string[] {
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
  /** Таймер сейчас отсчитывает гашение, а не показ карточки. */
  const clearing = useRef(false);

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
      ...splitForSubtitles(line.text).map((text, i) => ({ text, speaker: line.speaker, orig: line.orig, key: `${id}#${i}` })),
    );
    pump();
  }, [line]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Прокрутка очереди.
   *
   * Ожидание гашения — НЕ то же самое, что показ карточки. Раньше оба
   * состояния хранились в одном таймере, и вход `if (timer.current) return`
   * отсекал новую реплику, если она пришла в те семь секунд, пока полоса
   * доживала. Реплика оставалась в очереди, а таймер гашения, увидев
   * непустую очередь, ничего не гасил и никого не будил — полоса
   * замирала на последней карточке до конца доклада.
   *
   * Теперь пришедшая реплика прерывает ожидание и показывается сразу.
   */
  function pump() {
    if (timer.current) {
      if (!clearing.current) return; // идёт показ карточки — не мешаем
      clearTimeout(timer.current);
      timer.current = null;
      clearing.current = false;
    }
    step();
  }

  function step() {
    timer.current = null;
    clearing.current = false;

    const next = queue.current.shift();
    if (!next) {
      clearing.current = true;
      timer.current = setTimeout(() => {
        timer.current = null;
        clearing.current = false;
        setCard(null);
      }, CAPTIONS.CLEAR_AFTER_MS);
      return;
    }

    setCard(next);
    const dwell = Math.max(CAPTIONS.MIN_DWELL_MS, next.text.length * CAPTIONS.MS_PER_CHAR);
    timer.current = setTimeout(step, dwell);
  }

  /**
   * Уборка при размонтировании. Обнулять `timer.current` обязательно, а не
   * только гасить таймер: в режиме разработки React монтирует компонент
   * дважды, и после первой уборки ссылка на отменённый таймер оставалась
   * лежать. Дальше `pump()` видел «таймер занят» и выходил молча — полоса
   * показывала первую карточку и замирала навсегда, не обновляясь и не
   * гаснув. Очередь и метку последней реплики сбрасываем тем же движением,
   * иначе второй проход не поставит карточку заново.
   */
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      clearing.current = false;
      queue.current = [];
      lastFinalId.current = '';
    };
  }, []);

  if (!card) return null;

  const fromAudience = card.speaker === 'audience';

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center"
      style={{ height, background: settings.background }}
    >
      <div key={card.key} className="flex max-w-[88%] flex-col items-center gap-1">
        {/* Оригинал прописными и мелко: он не спорит с переводом за
            внимание, потому что читается как метка, а не как текст. */}
        {card.orig ? (
          <div
            className="max-w-full truncate uppercase"
            style={{
              fontSize: Math.round(settings.fontSize * 0.34),
              letterSpacing: '.06em',
              color: '#ffffff',
              opacity: 0.55,
              textShadow: '0 2px 10px rgba(0,0,0,0.9)',
            }}
          >
            {card.orig}
          </div>
        ) : null}
        <div
          className="text-center"
          style={{
            // Реплики зала жёлтые: зритель должен с одного взгляда понимать,
            // переводят ему докладчика или коллегу из зала (§9).
            color: fromAudience ? 'var(--warn, #e3b341)' : settings.color,
            fontSize: settings.fontSize,
            lineHeight: 1.24,
            fontWeight: 600,
            textShadow: '0 2px 14px rgba(0,0,0,0.9)',
            textWrap: 'balance',
          }}
        >
          {card.text}
        </div>
      </div>
    </div>
  );
}
