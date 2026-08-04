// Хранение. Два разных хранилища по разным причинам (ТЗ §6а, §10):
//   localStorage — профиль, настройки, разметка. Мелкое, синхронное, редкое.
//   IndexedDB    — лог реплик. Может вырасти, пишется каждые 10 секунд,
//                  и синхронный localStorage подтормаживал бы главный поток.

import { DEFAULT_PROFILE, normalizeModes } from './profile';
import { ALL_LANGS, type Annotations, type Entry, type Lang, type MeetingProfile, type Shape } from './types';

const K = {
  profile: 'aip.profile',
  captions: 'aip.captions',
  apiKey: 'aip.geminiKey',
  tier: 'aip.geminiTier',
  cap: 'aip.geminiCap',
  glossary: 'aip.glossary',
  annPrefix: 'aip.ann.',
};

function readJSON<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* переполнение квоты не должно ронять презентацию */
  }
}

/**
 * Профиль из прошлых запусков. Поля добираются из умолчаний: состав
 * профиля со временем меняется, и сохранённый вчера объект не обязан
 * содержать то, что появилось сегодня — иначе приложение падает на
 * пустом списке языков вместо того, чтобы просто открыться.
 */
export function loadProfile(): MeetingProfile | null {
  const raw = readJSON<Partial<MeetingProfile>>(K.profile);
  return raw ? normalizeModes({ ...DEFAULT_PROFILE, ...raw }) : null;
}

export const saveProfile = (p: MeetingProfile) => writeJSON(K.profile, p);

export const loadCaptionSettings = <T,>() => readJSON<T>(K.captions);
export const saveCaptionSettings = (s: unknown) => writeJSON(K.captions, s);

export const loadApiKey = (): string => (typeof localStorage === 'undefined' ? '' : localStorage.getItem(K.apiKey) ?? '');
export const saveApiKey = (k: string) => {
  if (typeof localStorage === 'undefined') return;
  if (k) localStorage.setItem(K.apiKey, k);
  else localStorage.removeItem(K.apiKey);
};

/** Тариф ключа: от него зависит допустимая частота запросов, а не только
 *  суточный объём. Угадать его нельзя — API его не сообщает. */
export const loadTier = (): string =>
  typeof localStorage === 'undefined' ? 'free' : (localStorage.getItem(K.tier) ?? 'free');
export const saveTier = (t: string) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(K.tier, t);
};

/** Жёсткий потолок запросов. Единственная защита, которая реально
 *  останавливает: уведомления Google приходят постфактум. */
export const loadCap = (): number => {
  if (typeof localStorage === 'undefined') return 400;
  const v = Number(localStorage.getItem(K.cap));
  return Number.isFinite(v) && v >= 10 ? v : 400;
};
export const saveCap = (n: number) => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(K.cap, String(n));
};

export const loadGlossary = () => readJSON<{ from: string; to: string }[]>(K.glossary) ?? [];
export const saveGlossary = (g: { from: string; to: string }[]) => writeJSON(K.glossary, g);

// --- Разметка -------------------------------------------------------------
// Ключ включает отпечаток документа, иначе разметка от прошлой колоды
// всплывёт на новой.

export function loadAnnotations(docId: string): Annotations {
  return readJSON<Annotations>(K.annPrefix + docId) ?? {};
}

export function saveAnnotations(docId: string, ann: Annotations): void {
  // Пустые слайды не храним — иначе ключ пухнет от нулей.
  const trimmed: Annotations = {};
  for (const [k, v] of Object.entries(ann)) if (v && v.length) trimmed[Number(k)] = v as Shape[];
  writeJSON(K.annPrefix + docId, trimmed);
}

/** Отпечаток документа: размер + первые и последние байты. Хеш всего файла
 *  на 30-мегабайтной колоде занял бы заметное время при загрузке. */
export async function fingerprint(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 4096)).arrayBuffer());
  let h = 2166136261 >>> 0;
  const mix = (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) {
      h ^= arr[i];
      h = Math.imul(h, 16777619) >>> 0;
    }
  };
  mix(head);
  mix(tail);
  return `${file.size.toString(36)}-${h.toString(36)}`;
}

// --- Лог реплик в IndexedDB ----------------------------------------------

const DB = 'ai-present';
const STORE = 'entries';
const DECK_STORE = 'deck';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DECK_STORE)) db.createObjectStore(DECK_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Колоды, которые уже открывали. Лежат здесь по двум причинам: окно показа
 * забирает файл само (через BroadcastChannel мегабайты не гоняют, а
 * перетаскивать один файл дважды — издевательство), и повторное открытие
 * той же колоды на репетициях становится одним кликом.
 */
export type DeckRecord = {
  docId: string;
  name: string;
  pages: number;
  /** Превью первой страницы, dataURL. Хранится готовым: перерисовывать
   *  его при каждом показе списка значит грузить pdf.js ради миниатюр. */
  thumb: string;
  openedAt: number;
  /** Языки, для которых у колоды есть свой файл. Первый — основной:
   *  на него падает показ, когда для выбранного языка перевода нет. */
  langs: Lang[];
};

/** Сколько колод помним. Больше — это уже файловый менеджер. */
const DECK_LIMIT = 8;

const CURRENT = '__current__';

/**
 * Сохранить колоду со всеми её языковыми версиями.
 *
 * Версии лежат в одной записи, а не отдельными колодами: это один и тот
 * же доклад, у них общий отпечаток, общая разметка и одно место в
 * галерее. Порядок files задаёт основной язык — первый.
 */
export async function saveDeckFiles(
  docId: string,
  files: { lang: Lang; file: File }[],
  meta: { pages: number; thumb: string },
): Promise<void> {
  if (typeof indexedDB === 'undefined' || !files.length) return;
  const blobs: Partial<Record<Lang, Blob>> = {};
  for (const { lang, file } of files) blobs[lang] = file;

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, 'readwrite');
    const store = tx.objectStore(DECK_STORE);
    store.put(
      {
        docId,
        name: files[0].file.name,
        blobs,
        langs: files.map((f) => f.lang),
        openedAt: Date.now(),
        ...meta,
      },
      docId,
    );
    store.put(docId, CURRENT);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  await trimDecks();
}

/** Записи прежних версий приложения хранили один файл в blob и не знали
 *  про языки. Читаем и такие: колода, открытая вчера, обязана открыться. */
type StoredDeck = DeckRecord & { blob?: Blob; blobs?: Partial<Record<Lang, Blob>> };

function deckBlobs(r: StoredDeck): { lang: Lang; blob: Blob }[] {
  if (r.blobs) return (r.langs ?? []).map((l) => ({ lang: l, blob: r.blobs![l]! })).filter((x) => x.blob instanceof Blob);
  return r.blob instanceof Blob ? [{ lang: LEGACY_LANG, blob: r.blob }] : [];
}

/** Язык, приписываемый старым записям без языковой разметки. Он же
 *  основной, поэтому показывается всегда — как и раньше. */
const LEGACY_LANG: Lang = ALL_LANGS[0];

async function allDecks(): Promise<StoredDeck[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDb();
  const rows = await new Promise<unknown[]>((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, 'readonly');
    const req = tx.objectStore(DECK_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows.filter((r): r is StoredDeck => typeof r === 'object' && r !== null && 'docId' in r);
}

/**
 * Список для галереи: без самих файлов, только то, что рисуется.
 *
 * Записи без пригодного файла отсеиваются СРАЗУ и удаляются. Показать
 * превью колоды, которая не откроется, — худший вариант: пользователь
 * жмёт на неё в начале встречи и получает ошибку вместо слайдов.
 * Хранилище браузера чистится по своим правилам, так что это не теория.
 */
export async function listDecks(): Promise<DeckRecord[]> {
  const rows = await allDecks();
  const good: DeckRecord[] = [];

  for (const r of rows) {
    const files = deckBlobs(r);
    const usable = files.length > 0 && files.every((f) => f.blob.size > 0) && typeof r.thumb === 'string' && r.thumb.length > 0;
    if (usable) {
      good.push({
        docId: r.docId,
        name: r.name,
        pages: r.pages,
        thumb: r.thumb,
        openedAt: r.openedAt,
        langs: files.map((f) => f.lang),
      });
    } else void forgetDeck(r.docId);
  }

  return good.sort((a, b) => b.openedAt - a.openedAt);
}

export async function loadDeckById(docId: string): Promise<{ lang: Lang; file: File }[]> {
  const rec = (await allDecks()).find((r) => r.docId === docId);
  if (!rec) return [];
  return deckBlobs(rec).map(({ lang, blob }) => ({
    lang,
    file: new File([blob], rec.name, { type: 'application/pdf' }),
  }));
}

/** Последняя открытая — её подхватывает окно показа при старте. */
export async function loadDeckFile(): Promise<{ lang: Lang; file: File }[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDb();
  const id = await new Promise<string | undefined>((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, 'readonly');
    const req = tx.objectStore(DECK_STORE).get(CURRENT);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return id ? loadDeckById(id) : [];
}

export async function forgetDeck(docId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, 'readwrite');
    tx.objectStore(DECK_STORE).delete(docId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** Старые колоды вытесняются: это кэш, а не архив, и PDF весят мегабайты. */
async function trimDecks(): Promise<void> {
  const rows = await listDecks();
  for (const old of rows.slice(DECK_LIMIT)) await forgetDeck(old.docId);
}

/** Сохраняются только финальные записи: промежуточные меняются по десять раз
 *  в секунду и в хранилище им делать нечего. */
export async function persistEntries(entries: Entry[]): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const finals = entries.filter((e) => e.isFinal);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const e of finals) store.put(e);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function restoreEntries(): Promise<Entry[]> {
  if (typeof indexedDB === 'undefined') return [];
  const db = await openDb();
  const out = await new Promise<Entry[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as Entry[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out.sort((a, b) => a.ts - b.ts);
}

export async function clearEntries(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
