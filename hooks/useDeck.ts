'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { openDeck, PageRenderer, type Deck } from '@/lib/pdf';
import { extractTerms } from '@/lib/glossary';
import { forgetDeck, listDecks, loadDeckById, saveDeckFiles, fingerprint, type DeckRecord } from '@/lib/storage';
import { getBus } from '@/lib/bus';
import { sideRoom } from '@/lib/geometry';
import { SIDE_COLUMN } from '@/lib/constants';
import { useStore } from '@/lib/store';
import type { Lang } from '@/lib/types';

/** Одна языковая версия колоды: разобранный документ и его отрисовщик. */
export type DeckVariant = { deck: Deck; renderer: PageRenderer };

/**
 * Загрузка колоды: разбор PDF, отпечаток для привязки разметки, словарь
 * терминов из текста страниц и автоматический выбор компоновки субтитров.
 *
 * Языковых версий может быть несколько — один и тот же доклад, набранный
 * на разных языках. Они держатся вместе: общий отпечаток, общая разметка,
 * одно место в галерее. Показывается та, на языке которой сейчас читают,
 * а номер слайда общий — переключение языка не сбивает место в докладе.
 */
export function useDeck() {
  const [variants, setVariants] = useState<Partial<Record<Lang, DeckVariant>>>({});
  const [primary, setPrimary] = useState<Lang | null>(null);
  const [recent, setRecent] = useState<DeckRecord[]>([]);
  const terms = useRef<string[]>([]);
  // Для освобождения при закрытии окна: эффект с зависимостью от variants
  // рвал бы отрисовщики прямо в момент замены колоды.
  const live = useRef<Partial<Record<Lang, DeckVariant>>>({});

  const refreshRecent = useCallback(() => void listDecks().then(setRecent), []);
  useEffect(refreshRecent, [refreshRecent]);

  const load = useCallback(
    async (files: { lang: Lang; file: File }[]) => {
      const st = useStore.getState();
      if (!files.length) return;
      try {
        const built: Partial<Record<Lang, DeckVariant>> = {};
        for (const { lang, file } of files) {
          const deck = await openDeck(file);
          built[lang] = { deck, renderer: new PageRenderer(deck) };
        }

        const base = built[files[0].lang]!;
        const id = await fingerprint(files[0].file);

        // Версии обязаны совпадать по числу страниц: слайд выбирается
        // номером, и на разъехавшихся колодах переключение языка молча
        // показало бы не тот слайд.
        for (const { lang } of files.slice(1)) {
          const v = built[lang];
          if (!v || v.deck.pageCount === base.deck.pageCount) continue;
          st.toast_(`${lang.toUpperCase()}: ${v.deck.pageCount} ≠ ${base.deck.pageCount}`, 'error');
          v.renderer.destroy();
          delete built[lang];
        }

        for (const v of Object.values(live.current)) v?.renderer.destroy();
        live.current = built;
        setVariants(built);
        setPrimary(files[0].lang);

        st.setDeck(id, base.deck.pageCount, base.deck.aspect, Object.keys(built) as Lang[]);
        for (const w of base.deck.warnings) st.toast_(w.text, 'warn');

        // Компоновка субтитров выводится из формы колоды: узкая оставляет
        // свободные поля внутри расшаренного окна, и колонка занимает их;
        // широкая таких полей не даёт. Спрашивать об этом нечего.
        const room = sideRoom(16 / 9, base.deck.aspect);
        st.setCaptions({ layout: room >= SIDE_COLUMN.MIN_FRACTION ? 'side' : 'reserve' });

        // Превью для галереи делаем сразу: рисовать его при каждом показе
        // списка значит грузить pdf.js ради миниатюр.
        const thumb = await base.renderer.thumbnail(320);
        await saveDeckFiles(
          id,
          files.filter(({ lang }) => built[lang]),
          { pages: base.deck.pageCount, thumb },
        );
        getBus().send({ type: 'deck:changed', payload: { docId: id } });
        refreshRecent();

        // Словарь терминов для смещения распознавания (§6б). Со всех версий:
        // имена собственные в переводе те же, а термины вокруг них надо
        // узнавать на том языке, на котором их произнесут.
        const texts: string[] = [];
        for (const v of Object.values(built)) {
          for (let i = 0; i < v.deck.pageCount; i++) texts.push(await v.renderer.text(i));
        }
        terms.current = extractTerms(texts);
      } catch (e) {
        st.toast_(e instanceof Error ? e.message : String(e), 'error');
      }
    },
    [refreshRecent],
  );

  /** Открыть заново то, что уже открывали — репетиции идут по одной колоде. */
  const openRecent = useCallback(
    async (docId: string) => {
      const files = await loadDeckById(docId);
      if (files.length) await load(files);
    },
    [load],
  );

  /**
   * Закрыть колоду и вернуться в галерею. Отрисовщики рвём здесь же:
   * иначе закрытая колода продолжает держать страницы pdf.js, а ради
   * этого закрытие и делают.
   *
   * Окну показа об этом не сообщаем. Оно берёт из хранилища последний
   * файл, а не текущий docId, и «deck:changed» заставил бы его молча
   * перезагрузить ту же колоду — то есть ничего не закрыть.
   */
  const closeDeck = useCallback(() => {
    for (const v of Object.values(live.current)) v?.renderer.destroy();
    live.current = {};
    setVariants({});
    setPrimary(null);
    terms.current = [];
    useStore.getState().clearDeck();
  }, []);

  const forget = useCallback(
    async (docId: string) => {
      await forgetDeck(docId);
      refreshRecent();
    },
    [refreshRecent],
  );

  // Освобождаем страницы pdf.js: без этого час показа даёт утечку.
  useEffect(
    () => () => {
      for (const v of Object.values(live.current)) v?.renderer.destroy();
    },
    [],
  );

  return { variants, primary, terms, recent, load, openRecent, closeDeck, forget };
}
