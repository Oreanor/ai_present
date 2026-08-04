'use client';

import { useState } from 'react';
import { guessLang } from '@/lib/deck-langs';
import type { DeckRecord } from '@/lib/storage';
import { ALL_LANGS, LANG_NAMES, type Lang } from '@/lib/types';
import { useT } from '@/lib/ui-prefs';

/**
 * Экран без загруженной колоды: крупные превью того, что уже открывали,
 * и выбор файлов.
 *
 * Файлов можно дать несколько — один доклад на разных языках. Язык
 * каждого предлагается по имени (talk-pt.pdf), но показывается и правится:
 * молча открыть португальский файл как английский значит показать залу не
 * тот текст и узнать об этом на середине доклада.
 *
 * Записи без пригодного файла сюда не доходят — их отсеивает хранилище:
 * превью колоды, которая не откроется, хуже отсутствия превью.
 */
export function DeckGallery({
  recent,
  onOpenFiles,
  onOpenRecent,
  onForget,
}: {
  recent: DeckRecord[];
  onOpenFiles: (files: { lang: Lang; file: File }[]) => void;
  onOpenRecent: (docId: string) => void;
  onForget: (docId: string) => void;
}) {
  const t = useT();
  const [over, setOver] = useState(false);
  /** Выбранные файлы в ожидании подтверждения языков. */
  const [pending, setPending] = useState<{ file: File; lang: Lang }[]>([]);

  const accept = (list: FileList | null) => {
    const pdfs = [...(list ?? [])].filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) return;

    // Один файл — открываем сразу: спрашивать язык не о чем, он и есть
    // единственный. Несколько — показываем, что чем распозналось.
    if (pdfs.length === 1) {
      onOpenFiles([{ lang: guessLang(pdfs[0].name) ?? ALL_LANGS[0], file: pdfs[0] }]);
      return;
    }
    const taken = new Set<Lang>();
    setPending(
      pdfs.map((file) => {
        const guess = guessLang(file.name);
        const lang = guess && !taken.has(guess) ? guess : (ALL_LANGS.find((l) => !taken.has(l)) ?? ALL_LANGS[0]);
        taken.add(lang);
        return { file, lang };
      }),
    );
  };

  if (pending.length) {
    return (
      <ConfirmLangs
        files={pending}
        onChange={setPending}
        onCancel={() => setPending([])}
        onOpen={() => {
          onOpenFiles(pending.map(({ lang, file }) => ({ lang, file })));
          setPending([]);
        }}
      />
    );
  }

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
        accept(e.dataTransfer.files);
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
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.thumb} alt="" className="block w-full" />
                    {/* Языки — метками в углу самой обложки. В строке под
                        именем они читались как продолжение числа слайдов. */}
                    {d.langs.length > 1 ? (
                      <div className="absolute left-1.5 top-1.5 flex gap-1">
                        {d.langs.map((l) => (
                          <span
                            key={l}
                            className="rounded border border-white/25 bg-black/65 px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none text-white/85"
                          >
                            {l}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
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
        className={`mt-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-8 text-sm transition-colors ${
          over ? 'border-accent text-white' : 'border-white/20 text-white/50 hover:border-white/40'
        } ${recent.length === 0 ? 'mt-0 h-full' : ''}`}
      >
        <input
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => accept(e.target.files)}
        />
        <span className="text-center">
          {recent.length ? t('openAnother') : t('dropPdf')}
          <br />
          <span className="text-xs opacity-60">{t('orClick')}</span>
        </span>
        <span className="mt-2 max-w-[46ch] text-center text-xs opacity-45">{t('multiLangHint')}</span>
      </label>
    </div>
  );
}

/** Подтверждение языков перед открытием. Один файл сюда не попадает. */
function ConfirmLangs({
  files,
  onChange,
  onCancel,
  onOpen,
}: {
  files: { file: File; lang: Lang }[];
  onChange: (next: { file: File; lang: Lang }[]) => void;
  onCancel: () => void;
  onOpen: () => void;
}) {
  const t = useT();
  // Два файла на один язык — это опечатка в выборе, а не конфигурация:
  // второй молча затёр бы первый.
  const clash = new Set(files.map((f) => f.lang)).size !== files.length;

  return (
    <div className="absolute inset-0 overflow-y-auto p-6">
      <p className="text-sm text-white/90">{t('whichLangIsWhich')}</p>
      <p className="mt-1 max-w-[60ch] text-xs text-white/50">{t('firstIsPrimary')}</p>

      <div className="mt-4 space-y-2">
        {files.map((f, i) => (
          <div key={f.file.name} className="flex items-center gap-3 rounded-lg border border-white/15 bg-black/30 p-2">
            <span className="min-w-0 flex-1 truncate text-[13px] text-white/85" title={f.file.name}>
              {i === 0 ? (
                <span className="mr-1.5 font-mono text-[10px] uppercase text-accent">{t('primary')}</span>
              ) : null}
              {f.file.name}
            </span>
            <div className="flex gap-1">
              {ALL_LANGS.map((l) => (
                <button
                  key={l}
                  onClick={() => onChange(files.map((x, j) => (j === i ? { ...x, lang: l } : x)))}
                  className={`rounded px-2 py-1 text-[11px] ${
                    f.lang === l ? 'bg-accent text-[color:var(--on-accent)]' : 'text-white/70 hover:bg-white/10'
                  }`}
                >
                  {LANG_NAMES[l]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button onClick={onOpen} disabled={clash} className="btn btn-primary px-4 py-2">
          {t('openDeck')}
        </button>
        <button onClick={onCancel} className="btn px-3 py-2">
          {t('cancel')}
        </button>
        {clash ? <span className="text-xs text-err">{t('langClash')}</span> : null}
      </div>
    </div>
  );
}
