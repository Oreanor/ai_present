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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
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
