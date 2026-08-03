'use client';

import { useState } from 'react';
import type { DeckRecord } from '@/lib/storage';
import { useT } from '@/lib/ui-prefs';

/**
 * Экран без загруженной колоды: крупные превью того, что уже открывали,
 * и кнопка выбрать другой файл.
 *
 * Репетиции идут по одной и той же колоде, и перетаскивать её заново
 * перед каждым прогоном незачем. Записи без пригодного файла сюда не
 * доходят — их отсеивает хранилище: превью колоды, которая не откроется,
 * хуже отсутствия превью.
 */
export function DeckGallery({
  recent,
  onOpenFile,
  onOpenRecent,
  onForget,
}: {
  recent: DeckRecord[];
  onOpenFile: (f: File) => void;
  onOpenRecent: (docId: string) => void;
  onForget: (docId: string) => void;
}) {
  const t = useT();
  const [over, setOver] = useState(false);

  const accept = (f: File | undefined) => {
    if (f?.name.toLowerCase().endsWith('.pdf')) onOpenFile(f);
  };

  return (
    <div
      className={`absolute inset-0 overflow-y-auto p-5 transition-colors ${over ? 'bg-accent/10' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        accept(e.dataTransfer.files[0]);
      }}
    >
      {recent.length > 0 ? (
        <>
          <p className="mb-3 text-[10px] uppercase tracking-wide text-white/40">{t('recentDecks')}</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
            {recent.map((d) => (
              <div key={d.docId} className="group relative">
                <button
                  onClick={() => onOpenRecent(d.docId)}
                  className="block w-full overflow-hidden rounded-lg border border-white/15 bg-black/40 text-left transition-colors hover:border-accent"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.thumb} alt="" className="block w-full" />
                  <div className="px-2.5 py-2">
                    <div className="truncate text-[13px] text-white/90" title={d.name}>
                      {d.name}
                    </div>
                    <div className="text-[11px] text-white/45">
                      {d.pages} {t('slidesCount')}
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => onForget(d.docId)}
                  className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white/70 opacity-0 transition-opacity group-hover:opacity-100 hover:text-white"
                  title={t('forgetDeck')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <label
        className={`mt-5 flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed py-8 text-sm transition-colors ${
          over ? 'border-accent text-white' : 'border-white/20 text-white/50 hover:border-white/40'
        } ${recent.length === 0 ? 'mt-0 h-full' : ''}`}
      >
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => accept(e.target.files?.[0])}
        />
        <span className="text-center">
          {recent.length ? t('openAnother') : t('dropPdf')}
          <br />
          <span className="text-xs opacity-60">{t('orClick')}</span>
        </span>
      </label>
    </div>
  );
}
