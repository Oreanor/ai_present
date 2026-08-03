// Хранение. Два разных хранилища по разным причинам (ТЗ §6а, §10):
//   localStorage — профиль, настройки, разметка. Мелкое, синхронное, редкое.
//   IndexedDB    — лог реплик. Может вырасти, пишется каждые 10 секунд,
//                  и синхронный localStorage подтормаживал бы главный поток.

import type { Annotations, Entry, MeetingProfile, Shape } from './types';

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

export const loadProfile = () => readJSON<MeetingProfile>(K.profile);
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
 * Сам файл колоды. Лежит здесь, чтобы окно показа забрало его само:
 * через BroadcastChannel гонять мегабайты нельзя, а требовать один
 * и тот же файл перетащить дважды — издевательство.
 */
export async function saveDeckFile(docId: string, file: File): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, 'readwrite');
    tx.objectStore(DECK_STORE).put({ docId, name: file.name, blob: file }, 'current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadDeckFile(): Promise<File | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openDb();
  const rec = await new Promise<{ name: string; blob: Blob } | undefined>((resolve, reject) => {
    const tx = db.transaction(DECK_STORE, 'readonly');
    const req = tx.objectStore(DECK_STORE).get('current');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  if (!rec) return null;
  return new File([rec.blob], rec.name, { type: 'application/pdf' });
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
