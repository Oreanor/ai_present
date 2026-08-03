'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * Размер элемента через ResizeObserver.
 *
 * Не `window.innerWidth`: тот не обновляется при части изменений —
 * полноэкранный режим, зум, смена метрик, — и слайд уезжает за границы
 * окна прямо в трансляции. Наблюдение за самим контейнером надёжно
 * независимо от причины изменения.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return size;
}
