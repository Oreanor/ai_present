'use client';

import { useEffect, useRef, useState } from 'react';
import type { CaptionSettings, Speaker } from '@/lib/types';

/**
 * Полоса субтитров (§9). Показывает ВСЕГДА и только captionLang — сюда
 * приходит уже готовая строка, компонент языков не знает.
 *
 * Никаких rAF: только CSS-переходы. Перекрытое окно Chrome перестаёт
 * обслуживать rAF, а Teams продолжает транслировать зрителям.
 */
export function CaptionBand({
  line,
  settings,
  height,
}: {
  line: { text: string; final: boolean; speaker: Speaker } | null;
  settings: CaptionSettings;
  height: number;
}) {
  const [shown, setShown] = useState<{ text: string; final: boolean; speaker: Speaker } | null>(null);
  const holdUntil = useRef(0);
  const pending = useRef<typeof shown>(null);

  // Финальная строка держится минимум 2 секунды даже при быстрой речи (§9),
  // иначе зритель не успевает дочитать.
  useEffect(() => {
    if (!line) return;
    const now = performance.now();
    if (now >= holdUntil.current) {
      setShown(line);
      if (line.final) holdUntil.current = now + 2000;
      return;
    }
    pending.current = line;
    const t = setTimeout(() => {
      if (pending.current) {
        setShown(pending.current);
        if (pending.current.final) holdUntil.current = performance.now() + 2000;
        pending.current = null;
      }
    }, holdUntil.current - now);
    return () => clearTimeout(t);
  }, [line]);

  if (!settings.visible || !shown?.text) return null;

  const fromAudience = shown.speaker === 'audience';

  return (
    <div
      className="absolute inset-x-0 bottom-0 flex items-center justify-center"
      style={{ height, background: settings.background }}
    >
      <div
        className="max-w-[92%] text-center transition-opacity duration-150"
        style={{
          // Реплики зала оформлены иначе: зритель должен с одного взгляда
          // понимать, переводят ему докладчика или коллегу из зала (§9).
          color: fromAudience ? '#cfe3ff' : settings.color,
          fontSize: settings.fontSize,
          lineHeight: 1.25,
          fontWeight: 600,
          opacity: shown.final ? 1 : 0.72,
          textShadow: '0 2px 12px rgba(0,0,0,0.85)',
          paddingLeft: fromAudience ? '1.6em' : 0,
          textIndent: fromAudience ? '-1.6em' : 0,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {fromAudience ? <span style={{ opacity: 0.75, marginRight: '0.45em' }}>❝</span> : null}
        {shown.text}
      </div>
    </div>
  );
}
