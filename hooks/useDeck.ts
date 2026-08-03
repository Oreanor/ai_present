'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { openDeck, PageRenderer, type Deck } from '@/lib/pdf';
import { extractTerms } from '@/lib/glossary';
import { fingerprint } from '@/lib/storage';
import { sideRoom } from '@/lib/geometry';
import { SIDE_COLUMN } from '@/lib/constants';
import { useStore } from '@/lib/store';

/**
 * Загрузка колоды: разбор PDF, отпечаток для привязки разметки, словарь
 * терминов из текста страниц и автоматический выбор компоновки субтитров.
 *
 * Отдельно от компонента, потому что это связная процедура из пяти шагов,
 * а не разметка. В странице от неё остаётся одна строка.
 */
export function useDeck() {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [renderer, setRenderer] = useState<PageRenderer | null>(null);
  const terms = useRef<string[]>([]);

  const load = useCallback(async (file: File) => {
    const st = useStore.getState();
    try {
      const d = await openDeck(file);
      const id = await fingerprint(file);
      const r = new PageRenderer(d);

      setDeck(d);
      setRenderer(r);
      st.setDeck(id, d.pageCount, d.aspect);
      for (const w of d.warnings) st.toast_(w.text, 'warn');

      // Компоновка субтитров выводится из формы колоды: узкая оставляет
      // свободные поля внутри расшаренного окна, и колонка занимает их;
      // широкая таких полей не даёт. Спрашивать об этом нечего.
      const room = sideRoom(16 / 9, d.aspect);
      st.setCaptions({ layout: room >= SIDE_COLUMN.MIN_FRACTION ? 'side' : 'reserve' });

      // Словарь терминов для смещения распознавания (§6б).
      const texts: string[] = [];
      for (let i = 0; i < d.pageCount; i++) texts.push(await r.text(i));
      terms.current = extractTerms(texts);
    } catch (e) {
      st.toast_(e instanceof Error ? e.message : String(e), 'error');
    }
  }, []);

  // Освобождаем страницы pdf.js: без этого час показа даёт утечку.
  useEffect(() => () => renderer?.destroy(), [renderer]);

  return { deck, renderer, terms, load };
}
