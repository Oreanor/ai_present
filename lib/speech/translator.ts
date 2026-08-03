import type { Lang } from '../types';

// Обёртка над Chrome Translator API — переводом на устройстве.
// Разведка (§15) подтвердила: все нужные пары работают напрямую,
// пивот через английский не требуется.

type TranslatorInstance = { translate(input: string): Promise<string>; destroy?(): void };

type TranslatorGlobal = {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }): Promise<TranslatorInstance>;
};

function api(): TranslatorGlobal | null {
  const g = globalThis as unknown as { Translator?: TranslatorGlobal };
  return g.Translator ?? null;
}

export function translatorSupported(): boolean {
  return api() !== null;
}

export type PairStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api' | 'error';

export async function pairAvailability(from: Lang, to: Lang): Promise<PairStatus> {
  const t = api();
  if (!t) return 'no-api';
  try {
    return (await t.availability({ sourceLanguage: from, targetLanguage: to })) as PairStatus;
  } catch {
    return 'error';
  }
}

const pool = new Map<string, Promise<TranslatorInstance>>();

/**
 * ВАЖНО: скачивание языкового пакета требует свежего пользовательского жеста.
 * Несколько create() подряд из одного обработчика клика падают все, кроме
 * первой (§15). Поэтому пакеты качаются на предполётной проверке по кнопке,
 * по одной паре, а не лениво в момент первой реплики.
 */
export function getTranslator(from: Lang, to: Lang, onProgress?: (p: number) => void): Promise<TranslatorInstance> {
  const key = `${from}>${to}`;
  const existing = pool.get(key);
  if (existing) return existing;

  const t = api();
  if (!t) return Promise.reject(new Error('Translator API is not available in this browser.'));

  const job = t
    .create({
      sourceLanguage: from,
      targetLanguage: to,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          onProgress?.((e as ProgressEvent).loaded);
        });
      },
    })
    .catch((e) => {
      pool.delete(key); // не кэшируем провал: следующий клик должен пробовать заново
      throw e;
    });

  pool.set(key, job);
  return job;
}

export async function translate(text: string, from: Lang, to: Lang): Promise<string> {
  if (from === to) return text;
  const t = await getTranslator(from, to);
  return t.translate(text);
}

export function disposeTranslators(): void {
  for (const job of pool.values()) void job.then((t) => t.destroy?.()).catch(() => {});
  pool.clear();
}
