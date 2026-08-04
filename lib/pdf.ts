import { RENDER } from './constants';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

// Воркер лежит локально (см. scripts/copy-pdf-worker.mjs): требование §11 —
// приложение обязано показывать слайды при полностью мёртвой сети.
//
// На file:// Chrome запрещает создавать Worker из файлового URL: origin
// там opaque. Поэтому в этом случае воркер не назначаем вовсе — pdf.js
// уходит на главный поток. Для колоды в 30 слайдов это заметно только
// на первой отрисовке, зато раздача коллегам файлом продолжает работать.
if (typeof window !== 'undefined' && location.protocol !== 'file:') {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', document.baseURI).toString();
}

/** Показывать ли пользователю, что рендер идёт без воркера. */
export const MAIN_THREAD_RENDERING = typeof window !== 'undefined' && location.protocol === 'file:';

export type DeckWarning = { level: 'warn' | 'error'; text: string };

export type Deck = {
  doc: PDFDocumentProxy;
  pageCount: number;
  /** Соотношение сторон первой страницы — под него подгоняется окно. */
  aspect: number;
  warnings: DeckWarning[];
  /** Текст страниц для словаря терминов (§6б). Заполняется лениво. */
  pageText: (string | null)[];
};

export async function openDeck(file: File): Promise<Deck> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const warnings: DeckWarning[] = [];

  const first = await doc.getPage(1);
  const v1 = first.getViewport({ scale: 1 });
  const aspect = v1.width / v1.height;

  if (aspect < 1) {
    warnings.push({
      level: 'warn',
      text: 'This deck is portrait. Captions will eat a lot of the slide — landscape is strongly preferred.',
    });
  }

  // Разнобой размеров даёт скачки кадра прямо в трансляции Teams.
  const probe = Math.min(doc.numPages, 12);
  for (let i = 2; i <= probe; i++) {
    const p = await doc.getPage(i);
    const v = p.getViewport({ scale: 1 });
    if (Math.abs(v.width / v.height - aspect) > 0.01) {
      warnings.push({
        level: 'warn',
        text: `Page ${i} has a different size than page 1. The shared frame will jump between slides.`,
      });
      p.cleanup();
      break;
    }
    p.cleanup();
  }
  first.cleanup();

  return { doc, pageCount: doc.numPages, aspect, warnings, pageText: new Array(doc.numPages).fill(null) };
}


/**
 * Кэш отрендеренных страниц с ограничением размера и обязательным cleanup().
 * Без cleanup pdf.js держит внутренние структуры страницы, и за час показа
 * это заметная утечка (критерий приёмки §14.12).
 */
export class PageRenderer {
  private cache = new Map<number, HTMLCanvasElement>();
  private pages = new Map<number, PDFPageProxy>();
  private inflight = new Map<number, { width: number; job: Promise<HTMLCanvasElement> }>();
  private order: number[] = [];

  constructor(
    private deck: Deck,
    private limit = RENDER.PAGE_CACHE,
  ) {}

  async render(index: number, cssWidth: number, dpr: number): Promise<HTMLCanvasElement> {
    const want = Math.round(cssWidth * dpr);

    const cached = this.cache.get(index);
    if (cached && cached.width === want) {
      this.touch(index);
      return cached;
    }

    // Незавершённый рендер годится, ТОЛЬКО если он той же ширины.
    // Иначе полноразмерный запрос получал бы миниатюру из галереи,
    // растянутую во весь экран, — и она висела бы мутной до тех пор,
    // пока перелистывание не заставит перерисовать.
    const running = this.inflight.get(index);
    if (running && running.width === want) return running.job;

    const job = this.draw(index, want);
    this.inflight.set(index, { width: want, job });
    try {
      return await job;
    } finally {
      if (this.inflight.get(index)?.job === job) this.inflight.delete(index);
    }
  }

  private async draw(index: number, pxWidth: number): Promise<HTMLCanvasElement> {
    const page = this.pages.get(index) ?? (await this.deck.doc.getPage(index + 1));
    this.pages.set(index, page);

    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: pxWidth / base.width });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d context unavailable');
    await page.render({ canvasContext: ctx, viewport }).promise;

    this.cache.set(index, canvas);
    this.touch(index);
    this.evict();
    return canvas;
  }

  /**
   * Миниатюра для галереи. Мимо кэша: иначе она вытесняет полноразмерный
   * слайд и подсовывается ему же, пока тот ещё не отрисован.
   */
  async thumbnail(pxWidth: number): Promise<string> {
    const page = await this.deck.doc.getPage(1);
    try {
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: pxWidth / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('2d context unavailable');
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL('image/jpeg', 0.7);
    } finally {
      page.cleanup();
    }
  }

  /** Предрендер соседей — перелистывание должно быть мгновенным (§6). */
  prefetch(index: number, cssWidth: number, dpr: number): void {
    for (const i of [index + 1, index - 1]) {
      if (i >= 0 && i < this.deck.pageCount && !this.cache.has(i)) {
        void this.render(i, cssWidth, dpr).catch(() => {});
      }
    }
  }

  async text(index: number): Promise<string> {
    const known = this.deck.pageText[index];
    if (known !== null) return known;
    const page = this.pages.get(index) ?? (await this.deck.doc.getPage(index + 1));
    this.pages.set(index, page);
    const content = await page.getTextContent();
    const s = content.items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    this.deck.pageText[index] = s;
    return s;
  }

  private touch(key: number): void {
    this.order = this.order.filter((k) => k !== key);
    this.order.push(key);
  }

  private evict(): void {
    while (this.order.length > this.limit) {
      const victim = this.order.shift();
      if (victim === undefined) break;
      this.cache.delete(victim);
      this.pages.get(victim)?.cleanup();
      this.pages.delete(victim);
    }
  }

  destroy(): void {
    for (const p of this.pages.values()) p.cleanup();
    this.pages.clear();
    this.cache.clear();
    this.order = [];
    void this.deck.doc.destroy();
  }
}
