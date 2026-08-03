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
  live,
  settings,
  width,
}: {
  history: { id: string; text: string; speaker: Speaker }[];
  live: { text: string; final: boolean; speaker: Speaker } | null;
  settings: CaptionSettings;
  width: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  // Прокрутка вниз без rAF: перекрытое окно Chrome не обслуживает rAF,
  // а Teams продолжает транслировать содержимое зрителям.
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, live]);

  if (!settings.visible) return null;

  // Живую строку не дублируем: она приходит и в history после финала.
  const showLive = live && !live.final;
  const size = Math.max(15, Math.round(settings.fontSize * 0.52));

  return (
    <div
      ref={boxRef}
      className="absolute inset-y-0 right-0 overflow-hidden"
      style={{ width, background: settings.background, padding: '3% 4%' }}
    >
      <div className="flex min-h-full flex-col justify-end gap-[0.75em]">
        {history.map((h, i) => (
          <p
            key={h.id}
            style={{
              color: h.speaker === 'audience' ? '#cfe3ff' : settings.color,
              fontSize: size,
              lineHeight: 1.35,
              fontWeight: 500,
              // Старое приглушается, но не исчезает: резкий обрыв читается
              // как поломка, а плавное угасание — как история.
              opacity: Math.max(0.28, 1 - (history.length - 1 - i) * 0.16),
              textShadow: '0 1px 6px rgba(0,0,0,0.7)',
            }}
          >
            {h.speaker === 'audience' ? <span style={{ opacity: 0.7 }}>❝ </span> : null}
            {h.text}
          </p>
        ))}

        {showLive ? (
          <p
            style={{
              color: live.speaker === 'audience' ? '#cfe3ff' : settings.color,
              fontSize: size,
              lineHeight: 1.35,
              fontWeight: 600,
              opacity: 0.75,
              textShadow: '0 1px 6px rgba(0,0,0,0.7)',
            }}
          >
            {live.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Сколько места остаётся сбоку при вписывании слайда в окно.
 * Колонка предлагается только когда его достаточно, чтобы текст читался.
 */
export function sideRoom(windowAspect: number, slideAspect: number): number {
  if (slideAspect >= windowAspect) return 0;
  return 1 - slideAspect / windowAspect;
}

export const SIDE_MIN_FRACTION = 0.16;
