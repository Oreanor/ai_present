'use client';

import { useEffect, useRef } from 'react';
import type { CaptionSettings, Speaker } from '@/lib/types';

/**
 * Боковая колонка субтитров. Занимает пустое место, которое всё равно
 * остаётся внутри расшаренного окна, когда слайд уже окна: колода 4:3
 * внутри экрана 16:9 оставляет ровно четверть ширины чёрной.
 *
 * ВАЖНО: здесь только язык аудитории и ничего больше. Приватный лог
 * (оригиналы, второй язык, разметка сторон) сюда не попадает — это окно
 * расшарено, и всё, что видно тут, видно клиенту.
 *
 * Зачем это лучше одной строки внизу: зритель, слушающий не на родном
 * языке, постоянно отстаёт на полфразы. Скроллбэк на несколько реплик
 * даёт догнать, не переспрашивая.
 */
export function CaptionColumn({
  history,
  settings,
  width,
}: {
  history: { id: string; text: string; speaker: Speaker }[];
  settings: CaptionSettings;
  width: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  // Прокрутка вниз без rAF: перекрытое окно Chrome не обслуживает rAF,
  // а Teams продолжает транслировать содержимое зрителям.
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history]);

  if (!settings.visible) return null;

  // Промежуточные результаты сюда не идут вовсе — по той же причине, что
  // и в полосу: дописывающийся по слову текст мешает читать. Колонка
  // показывает только договорённые фразы.
  const size = Math.max(15, Math.round(settings.fontSize * 0.5));

  return (
    <div
      ref={boxRef}
      className="absolute inset-y-0 right-0 overflow-hidden"
      style={{ width, background: settings.background, padding: '3% 4%' }}
    >
      {/*
        Связный текст, а не список карточек. Реплики идут одним потоком
        с обычными абзацными отбивками — так это читается как стенограмма,
        которую можно догнать глазами, а не как лента уведомлений.
        Смена говорящего отмечена только цветом и кавычкой: рамки и плашки
        рвут текст и мешают ровно тому, ради чего колонка существует.
      */}
      <div
        className="flex min-h-full flex-col justify-end"
        style={{ fontSize: size, lineHeight: 1.4, textShadow: '0 1px 6px rgba(0,0,0,0.7)' }}
      >
        {history.map((h, i) => {
          const prev = history[i - 1];
          const turned = !prev || prev.speaker !== h.speaker;
          return (
            <span
              key={h.id}
              style={{
                color: h.speaker === 'audience' ? '#cfe3ff' : settings.color,
                fontWeight: 450,
                // Старое приглушается, но не исчезает: резкий обрыв читается
                // как поломка, а плавное угасание — как история.
                opacity: Math.max(0.3, 1 - (history.length - 1 - i) * 0.14),
                // Отбивка только при смене говорящего — внутри реплик
                // одного человека текст идёт сплошняком.
                marginTop: turned && i > 0 ? '0.85em' : 0,
                display: 'block',
              }}
            >
              {turned && h.speaker === 'audience' ? <span style={{ opacity: 0.65 }}>❝ </span> : null}
              {h.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Сколько места остаётся сбоку при вписывании слайда в окно.
 * Колонка предлагается только когда его достаточно, чтобы текст читался.
 *
 * Потолок обязателен: у портретной колоды свободного остатка около 60%
 * ширины, и без ограничения колонка субтитров получается шире слайда.
 * Геометрически это честно, но выглядит так, будто показывают лог,
 * а слайд приложили сбоку. Излишек оставляем полями.
 */
export function sideRoom(windowAspect: number, slideAspect: number): number {
  if (slideAspect >= windowAspect) return 0;
  return Math.min(1 - slideAspect / windowAspect, SIDE_MAX_FRACTION);
}

export const SIDE_MIN_FRACTION = 0.16;
export const SIDE_MAX_FRACTION = 0.34;
