import type { PresentationState, Shape, ShapeKind } from './types';

// Межоконная шина (ТЗ §1). Сообщения версионированы: окна перезагружаются
// в разное время и могут оказаться разных версий.

export const BUS_VERSION = 1;
const CHANNEL = 'ai-present';

export type BusMessage =
  /** Presentation при загрузке просит полный снимок состояния. */
  | { v: number; type: 'hello' }
  /** Control отвечает снимком. Без этого перезагрузка Presentation
   *  посреди встречи оставляет окно в дефолтном состоянии. */
  | { v: number; type: 'state'; payload: PresentationState }
  /** Навигация работает в обоих окнах. */
  | { v: number; type: 'nav'; payload: { delta?: number; to?: number } }
  /** Разметку рисует Presentation, хранит Control. */
  | { v: number; type: 'shape:add'; payload: { slideIndex: number; shape: Shape } }
  | { v: number; type: 'shape:remove'; payload: { slideIndex: number; id: string } }
  | { v: number; type: 'shape:undo'; payload: { slideIndex: number } }
  | { v: number; type: 'shape:clear'; payload: { slideIndex: number; all?: boolean } }
  | { v: number; type: 'shape:kind'; payload: { kind: ShapeKind } }
  /** Хоткеи, нажатые в Presentation, исполняет Control. */
  | { v: number; type: 'cmd'; payload: { name: string } }
  /** Колода сменилась. Сам файл через шину не передаётся — это мегабайты;
   *  окно показа забирает его из IndexedDB само. */
  | { v: number; type: 'deck:changed'; payload: { docId: string } };

type Handler = (m: BusMessage) => void;

/** Omit по объединению надо распределять, иначе от союза остаются
 *  только общие поля и payload «исчезает». */
type Distribute<T> = T extends unknown ? Omit<T, 'v'> : never;
export type OutgoingMessage = Distribute<BusMessage>;

export class Bus {
  private ch: BroadcastChannel | null = null;
  private handlers = new Set<Handler>();

  constructor() {
    if (typeof BroadcastChannel === 'undefined') return;
    this.ch = new BroadcastChannel(CHANNEL);
    this.ch.onmessage = (e) => {
      const m = e.data as BusMessage;
      if (!m || typeof m !== 'object' || m.v !== BUS_VERSION) return;
      for (const h of this.handlers) h(m);
    };
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  send(m: OutgoingMessage): void {
    this.ch?.postMessage({ ...m, v: BUS_VERSION });
  }

  close(): void {
    this.ch?.close();
    this.ch = null;
    this.handlers.clear();
  }
}

let shared: Bus | null = null;

export function getBus(): Bus {
  if (!shared) shared = new Bus();
  return shared;
}
