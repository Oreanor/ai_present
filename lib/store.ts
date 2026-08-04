'use client';

import { create } from 'zustand';
import {
  DEFAULT_CAPTIONS,
  type Annotations,
  type CaptionSettings,
  type ChannelStatus,
  type Entry,
  type Lang,
  type LangMode,
  type MeetingProfile,
  type PresentationState,
  type Shape,
  type ShapeKind,
  type Speaker,
  type Utterance,
} from './types';
import { CAPTIONS, SIDE_COLUMN } from './constants';
import { DEFAULT_PROFILE, captionLangOf, modeCycle, nextMode, targetsFor, transcriptLangs } from './profile';
import { applyGlossary, type GlossaryEntry } from './glossary';
import { translate } from './speech/translator';
import { PALETTE, nextShapeKind } from './shapes';
import * as storage from './storage';


export type CaptionLine = { text: string; final: boolean; speaker: Speaker; orig: string; at: number };

/**
 * Язык, на котором сейчас читают: выбор зрителя, иначе язык аудитории из
 * профиля. Полоса субтитров и лента обязаны брать его из одного места —
 * зал видит их рядом, в одном окне.
 */
export function shownLang(s: { viewLang: Lang | null; profile: MeetingProfile }): Lang {
  return s.viewLang ?? captionLangOf(s.profile);
}

type State = {
  profile: MeetingProfile;
  captions: CaptionSettings;
  glossary: GlossaryEntry[];

  slideIndex: number;
  slideCount: number;
  deckAspect: number;
  docId: string;
  /** Языки, для которых у колоды есть свой файл. Пустой список — колода
   *  одна на все языки, и переключение языка её не меняет. */
  deckLangs: Lang[];

  annotations: Annotations;
  shapeKind: ShapeKind;
  shapeColor: string;

  entries: Entry[];
  captionLine: CaptionLine | null;
  /** Промежуточный результат. В расшаренную полосу не идёт (§9) —
   *  живёт только в Control как признак, что распознавание слышит. */
  partial: string | null;
  /** На каком языке читается лента. По умолчанию — язык аудитории:
   *  лог отдают участникам, и читать его будут прежде всего они. */
  viewLang: Lang | null;
  /** Прогресс массового перевода ленты на язык, которого в ней ещё нет. */
  translating: { lang: Lang; done: number; total: number } | null;

  presenterStatus: ChannelStatus;
  audienceStatus: ChannelStatus;
  toast: { text: string; kind: 'info' | 'warn' | 'error' } | null;

  // --- действия ---
  setProfile(p: MeetingProfile): void;
  setCaptions(patch: Partial<CaptionSettings>): void;
  setGlossary(g: GlossaryEntry[]): void;

  setDeck(docId: string, count: number, aspect: number, langs: Lang[]): void;
  goto(index: number): void;
  move(delta: number): void;

  addShape(s: Shape): void;
  removeShape(id: string): void;
  moveShape(id: string, dx: number, dy: number): void;
  undoShape(): void;
  clearShapes(all?: boolean): void;
  setShapeKind(k: ShapeKind): void;
  setShapeColor(c: string): void;
  cycleShapeKind(): void;

  ingest(u: Utterance, speaker: Speaker, isFinal: boolean): void;
  applyTranslation(id: string, lang: Lang, text: string): void;
  editEntry(id: string, lang: Lang | 'orig', text: string): void;
  toggleFlag(id: string): void;
  clearLog(): void;
  restoreLog(): Promise<void>;
  setViewLang(lang: Lang): Promise<void>;

  setStatus(ch: Speaker, s: ChannelStatus): void;
  cycleMode(ch: Speaker): LangMode | null;
  toast_(text: string, kind?: 'info' | 'warn' | 'error'): void;

  snapshot(): PresentationState;
};

export const useStore = create<State>((set, get) => ({
  profile: DEFAULT_PROFILE,
  captions: DEFAULT_CAPTIONS,
  glossary: [],

  slideIndex: 0,
  slideCount: 0,
  deckAspect: 16 / 9,
  docId: '',
  deckLangs: [],

  annotations: {},
  shapeKind: 'rect',
  shapeColor: PALETTE[0].value,

  entries: [],
  captionLine: null,
  partial: null,
  viewLang: null,
  translating: null,

  presenterStatus: 'idle',
  audienceStatus: 'idle',
  toast: null,

  setProfile(p) {
    storage.saveProfile(p);
    set({ profile: p });
  },

  setCaptions(patch) {
    const captions = { ...get().captions, ...patch };
    storage.saveCaptionSettings(captions);
    set({ captions });
  },

  setGlossary(g) {
    storage.saveGlossary(g);
    set({ glossary: g });
  },

  setDeck(docId, count, aspect, langs) {
    set({
      deckLangs: langs,
      docId,
      slideCount: count,
      deckAspect: aspect,
      slideIndex: 0,
      annotations: storage.loadAnnotations(docId),
    });
  },

  goto(index) {
    const { slideCount } = get();
    if (slideCount === 0) return;
    set({ slideIndex: Math.max(0, Math.min(slideCount - 1, index)) });
  },

  move(delta) {
    get().goto(get().slideIndex + delta);
  },

  addShape(s) {
    const { annotations, slideIndex, docId } = get();
    const list = [...(annotations[slideIndex] ?? []), s];
    const next = { ...annotations, [slideIndex]: list };
    storage.saveAnnotations(docId, next);
    set({ annotations: next });
  },

  removeShape(id) {
    const { annotations, slideIndex, docId } = get();
    const list = (annotations[slideIndex] ?? []).filter((s) => s.id !== id);
    const next = { ...annotations, [slideIndex]: list };
    storage.saveAnnotations(docId, next);
    set({ annotations: next });
  },

  /**
   * Перенос фигуры на dx/dy в долях области слайда. Фигура остаётся на
   * своём месте в стеке: она нарисована поверх соседей не случайно, и
   * подъём наверх при каждом сдвиге ломал бы порядок перекрытий.
   */
  moveShape(id, dx, dy) {
    const { annotations, slideIndex, docId } = get();
    const list = (annotations[slideIndex] ?? []).map((s) =>
      s.id === id
        ? {
            ...s,
            x1: s.x1 + dx,
            y1: s.y1 + dy,
            x2: s.x2 + dx,
            y2: s.y2 + dy,
            // Точки росчерка едут вместе с рамкой, иначе он остаётся на месте.
            points: s.points?.map((p) => ({ x: p.x + dx, y: p.y + dy })),
          }
        : s,
    );
    const next = { ...annotations, [slideIndex]: list };
    storage.saveAnnotations(docId, next);
    set({ annotations: next });
  },

  /** Правая кнопка: снимает последнюю фигуру, до нуля и дальше без ошибки. */
  undoShape() {
    const { annotations, slideIndex, docId } = get();
    const list = annotations[slideIndex] ?? [];
    if (!list.length) return;
    const next = { ...annotations, [slideIndex]: list.slice(0, -1) };
    storage.saveAnnotations(docId, next);
    set({ annotations: next });
  },

  clearShapes(all) {
    const { annotations, slideIndex, docId } = get();
    const next = all ? {} : { ...annotations, [slideIndex]: [] };
    storage.saveAnnotations(docId, next);
    set({ annotations: next });
  },

  setShapeKind(k) {
    set({ shapeKind: k });
  },
  setShapeColor(c) {
    set({ shapeColor: c });
  },
  cycleShapeKind() {
    set({ shapeKind: nextShapeKind(get().shapeKind) });
  },

  /**
   * Приём реплики. Обе стенограммы заполняются из texts напрямую —
   * никакой логики «кто говорил, значит показать то-то» (§10).
   */
  ingest(u, speaker, isFinal) {
    // Промежуточный результат в лог НЕ попадает. Фраза складывается туда
    // после того, как договорена — иначе лог наполняется строками-обрубками
    // с пустыми ячейками перевода, и связного текста из него не получается.
    // Живой признак работы распознавания живёт отдельно, в панели (§10).
    if (!isFinal) {
      set({ partial: speaker === 'presenter' ? u.origText : null });
      return;
    }

    const { entries, profile, slideIndex, glossary, captions } = get();

    const texts: Partial<Record<Lang, string>> = {};
    for (const [lang, value] of Object.entries(u.texts)) {
      if (value) texts[lang as Lang] = applyGlossary(value, glossary);
    }
    // Реплика на языке стенограммы попадает туда как оригинал, а не
    // переводится сама в себя (§3а).
    if (transcriptLangs(profile).includes(u.origLang)) texts[u.origLang] = applyGlossary(u.origText, glossary);

    const existing = entries.findIndex((e) => e.id === u.id);
    const entry: Entry = {
      id: u.id,
      ts: u.offsetMs,
      slideIndex,
      speaker,
      origLang: u.origLang,
      origText: u.origText,
      texts: existing >= 0 ? { ...entries[existing].texts, ...texts } : texts,
      isFinal: true,
    };

    let next: Entry[];
    if (existing >= 0) {
      if (entries[existing].edited) return; // ручную правку провайдер не перетирает
      next = [...entries];
      next[existing] = entry;
    } else {
      next = [...entries, entry];
    }

    // Полоса субтитров идёт на языке чтения — том же, что и лента.
    // Раньше это был жёстко язык из профиля, и переключатель над лентой
    // менял её, а полосу оставлял на прежнем языке: два разных языка в
    // одном окне, которое смотрит зал.
    const view = shownLang(get());
    const captionText = texts[view];
    let line = get().captionLine;
    const audienceSaidViewLang = speaker === 'audience' && u.origLang === view;
    const allowed = speaker === 'presenter' || (captions.showAudience && !audienceSaidViewLang);

    if (allowed && captionText) {
      // Реплика зала старше 15 секунд уже неактуальна и только собьёт зал (§9).
      const stale = speaker === 'audience' && u.durationMs !== undefined && performance.now() - u.offsetMs > CAPTIONS.MAX_AUDIENCE_AGE_MS;
      if (!stale) line = { text: captionText, final: true, speaker, orig: u.origText === captionText ? '' : u.origText, at: performance.now() };
    }

    set({ entries: next, captionLine: line, partial: null });
    void storage.persistEntries([entry]);

    // Язык чтения может не входить в стенограммы — тогда провайдер на него
    // не переводит. Догоняем на устройстве: иначе выбранный зрителем язык
    // работал бы только для того, что уже сказано.
    if (!texts[view] && u.origLang !== view) {
      void translate(u.origText, u.origLang, view)
        .then((out) => get().applyTranslation(u.id, view, out))
        .catch(() => {});
    }
  },

  applyTranslation(id, lang, text) {
    const { entries, glossary } = get();
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0) return;
    if (entries[i].edited) return;

    const value = applyGlossary(text, glossary);
    const next = [...entries];
    next[i] = { ...next[i], texts: { ...next[i].texts, [lang]: value } };

    // Догоняющий перевод дорисовывает полосу, если ждали именно его.
    let line = get().captionLine;
    if (lang === shownLang(get())) {
      const e = next[i];
      const allowed =
        e.speaker === 'presenter' || (get().captions.showAudience && e.origLang !== lang);
      if (allowed) line = { text: value, final: e.isFinal, speaker: e.speaker, orig: e.origText === value ? '' : e.origText, at: performance.now() };
    }

    set({ entries: next, captionLine: line });
    void storage.persistEntries([next[i]]);
  },

  editEntry(id, lang, text) {
    const { entries } = get();
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0) return;
    const next = [...entries];
    next[i] =
      lang === 'orig'
        ? { ...next[i], origText: text, edited: true }
        : { ...next[i], texts: { ...next[i].texts, [lang]: text }, edited: true };
    set({ entries: next });
    void storage.persistEntries([next[i]]);
  },

  toggleFlag(id) {
    const next = get().entries.map((e) => (e.id === id ? { ...e, flagged: !e.flagged } : e));
    set({ entries: next });
    const changed = next.find((e) => e.id === id);
    if (changed) void storage.persistEntries([changed]);
  },

  flagLast() {
    const finals = get().entries.filter((e) => e.isFinal);
    const last = finals[finals.length - 1];
    if (last) get().toggleFlag(last.id);
  },

  clearLog() {
    void storage.clearEntries();
    set({ entries: [], captionLine: null });
  },

  async restoreLog() {
    const entries = await storage.restoreEntries();
    if (entries.length) set({ entries });
  },

  /**
   * Смена языка чтения ленты. Две стенограммы хранятся всегда, поэтому
   * переключение между ними мгновенно. Для третьего языка версий нет —
   * догоняем переводом всей ленты разом, на устройстве и бесплатно.
   *
   * Вызывается по клику, и это существенно: скачивание языкового пакета
   * требует свежего пользовательского жеста.
   */
  async setViewLang(lang) {
    set({ viewLang: lang });

    // Полоса перескакивает на новый язык сразу, не дожидаясь следующей
    // реплики: переключатель стоит прямо над лентой, и рассинхрон между
    // ними виден в том же окне.
    const finals = get().entries.filter((e) => e.isFinal);
    const last = finals[finals.length - 1];
    if (last?.texts[lang]) {
      set({ captionLine: { text: last.texts[lang], final: true, speaker: last.speaker, orig: last.origText === last.texts[lang] ? '' : last.origText, at: performance.now() } });
    }

    const missing = get().entries.filter((e) => e.isFinal && !e.texts[lang]);
    if (!missing.length) return;

    set({ translating: { lang, done: 0, total: missing.length } });
    let done = 0;

    for (const e of missing) {
      try {
        const out = await translate(e.origText, e.origLang, lang);
        const list = get().entries;
        const i = list.findIndex((x) => x.id === e.id);
        if (i >= 0) {
          const next = [...list];
          next[i] = { ...next[i], texts: { ...next[i].texts, [lang]: applyGlossary(out, get().glossary) } };
          set({ entries: next });
          void storage.persistEntries([next[i]]);
        }
      } catch {
        // Пара языков недоступна — оставляем оригинал, но не срываем
        // остальную ленту из-за одной неудачной строки.
      }
      done += 1;
      set({ translating: { lang, done, total: missing.length } });
    }

    set({ translating: null });
  },


  setStatus(ch, s) {
    set(ch === 'presenter' ? { presenterStatus: s } : { audienceStatus: s });
  },

  /**
   * Перебор языка канала: языки профиля и AUTO по кругу (клавиша L для
   * микрофона, кнопка — для обоих). Возвращает новый режим или null,
   * если перебирать нечего: один язык без AUTO — это не выбор.
   */
  cycleMode(ch) {
    const { profile } = get();
    const langs = ch === 'presenter' ? profile.presenterLangs : profile.audienceLangs;
    const mode = ch === 'presenter' ? profile.presenterMode : profile.audienceMode;
    const allowAuto = !!storage.loadApiKey();
    if (modeCycle(langs, allowAuto).length < 2) return null;

    const next = nextMode(langs, mode, allowAuto);
    get().setProfile(
      ch === 'presenter' ? { ...profile, presenterMode: next } : { ...profile, audienceMode: next },
    );
    return next;
  },

  toast_(text, kind = 'info') {
    set({ toast: { text, kind } });
    setTimeout(() => {
      if (get().toast?.text === text) set({ toast: null });
    }, 5000);
  },

  snapshot() {
    const s = get();
    const cl = shownLang(s);

    // История для боковой колонки. Собирается ровно по тем же правилам,
    // что и полоса (§9): только captionLang, реплики зала на этом же
    // языке не дублируются. Ничего приватного сюда не просачивается.
    const history = s.entries
      .filter((e) => {
        if (!e.isFinal || !e.texts[cl]) return false;
        if (e.speaker === 'presenter') return true;
        return s.captions.showAudience && e.origLang !== cl;
      })
      .slice(-SIDE_COLUMN.HISTORY)
      .map((e) => ({ id: e.id, text: e.texts[cl] as string, speaker: e.speaker }));

    return {
      slideIndex: s.slideIndex,
      slideCount: s.slideCount,
      captions: s.captions,
      shapes: s.annotations[s.slideIndex] ?? [],
      shapeKind: s.shapeKind,
      shapeColor: s.shapeColor,
      // В окне показа одна точка состояния: зрителям незачем знать,
      // какой именно канал сейчас слушает.
      status: s.presenterStatus === 'listening' || s.audienceStatus === 'listening' ? 'listening' : s.presenterStatus,
      captionLine: s.captionLine
        ? { text: s.captionLine.text, final: s.captionLine.final, speaker: s.captionLine.speaker, orig: s.captionLine.orig }
        : null,
      captionHistory: history,
    };
  },
}));

/** Языки, в которые надо перевести реплику. Экспорт для провайдеров. */
export function currentTargets(origLang: Lang): Lang[] {
  return targetsFor(useStore.getState().profile, origLang);
}

/** Гидратация из localStorage. Вызывается один раз на клиенте: делать это
 *  в initial state нельзя — сервер и клиент разошлись бы разметкой. */
export function hydrateStore(): void {
  const profile = storage.loadProfile();
  const captions = storage.loadCaptionSettings<CaptionSettings>();
  const glossary = storage.loadGlossary();
  useStore.setState({
    ...(profile ? { profile } : {}),
    ...(captions ? { captions: { ...DEFAULT_CAPTIONS, ...captions } } : {}),
    ...(glossary.length ? { glossary } : {}),
  });
}
