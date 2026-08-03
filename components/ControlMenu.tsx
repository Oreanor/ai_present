'use client';

import { useEffect, useState } from 'react';
import { download, flaggedMarkdown, fullMarkdown } from '@/lib/export';
import { requiredPairs } from '@/lib/profile';
import { getTranslator, pairAvailability } from '@/lib/speech/translator';
import { useStore } from '@/lib/store';
import { HOTKEY_HELP } from '@/lib/hotkeys';
import { setTheme, setUiLang, type Theme, type UiLang } from '@/lib/ui-prefs';
import type { Lang } from '@/lib/types';

/**
 * Всё, чем не пользуются во время выступления.
 *
 * Здесь осталось только то, чему нет альтернативы: расстановку окон
 * делают мышью, компоновку субтитров приложение выбирает само по форме
 * колоды, а демо-режим — инструмент разработки, а не функция продукта.
 */
export function ControlMenu({
  onClose,
  theme,
  uiLang,
  used,
  geminiInUse,
  onOpenPresentation,
  onOpenWizard,
}: {
  onClose: () => void;
  theme: Theme;
  uiLang: UiLang;
  used: number;
  geminiInUse: boolean;
  onOpenPresentation: () => void;
  onOpenWizard: () => void;
}) {
  const state = useStore();

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="menu">
        <Group label="The window you share in Teams">
          <button className="menu-item" onClick={onOpenPresentation}>
            Open the presentation window
          </button>
        </Group>

        <PackList />

        <Group label="Appearance and interface language">
          <div className="flex gap-1">
            {(['dark', 'light'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setTheme(v)}
                className={`btn btn-sm flex-1 capitalize ${theme === v ? 'btn-on' : ''}`}
              >
                {v}
              </button>
            ))}
            {(['en', 'pt'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setUiLang(v)}
                className={`btn btn-sm font-semibold uppercase ${uiLang === v ? 'btn-on' : ''}`}
                title={v === 'en' ? 'English interface' : 'Interface em português'}
              >
                {v}
              </button>
            ))}
          </div>
        </Group>

        <Group label="Export">
          <button
            className="menu-item"
            onClick={() => download('log-full.md', fullMarkdown(state.entries, state.profile))}
          >
            Full log with originals
          </button>
          <button
            className="menu-item"
            onClick={() => download('follow-up.md', flaggedMarkdown(state.entries, state.profile.transcriptLangs[0]))}
          >
            Flagged items only
          </button>
        </Group>

        <Group label="Session">
          <button
            className="menu-item text-err"
            onClick={() => {
              if (confirm('Erase the whole log? Export first if you need it.')) state.clearLog();
            }}
          >
            Clear the log
          </button>
          <button className="menu-item" onClick={onOpenWizard}>
            Languages and setup…
          </button>
          {geminiInUse ? <p className="px-2 py-1 text-[11px] text-dim">Gemini requests used: {used}</p> : null}
        </Group>

        <Group label="Keyboard">
          {HOTKEY_HELP.map((h) => (
            <div key={h.keys} className="flex justify-between gap-2 px-2 py-0.5 text-[11px]">
              <span className="font-mono text-accent">{h.keys}</span>
              <span className="text-dim">{h.label}</span>
            </div>
          ))}
        </Group>
      </div>
    </>
  );
}

/**
 * Языковые пакеты. Живут здесь, а не только в мастере первого запуска:
 * скачивание требует свежего клика, а из колбэка распознавания его нет —
 * из-за этого перевод однажды молча не работал.
 */
function PackList() {
  const profile = useStore((s) => s.profile);
  const pairs = requiredPairs(profile);
  const [status, setStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const { from, to } of pairs) next[`${from}>${to}`] = await pairAvailability(from, to);
      if (!cancelled) setStatus((prev) => ({ ...next, ...prev }));
    })();
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(pairs)]); // eslint-disable-line react-hooks/exhaustive-deps

  const download_ = async (from: Lang, to: Lang) => {
    const key = `${from}>${to}`;
    setStatus((p) => ({ ...p, [key]: 'downloading' }));
    try {
      await getTranslator(from, to);
      setStatus((p) => ({ ...p, [key]: 'available' }));
    } catch (e) {
      setStatus((p) => ({ ...p, [key]: e instanceof Error ? e.name : 'error' }));
    }
  };

  const pending = pairs.filter(({ from, to }) => status[`${from}>${to}`] !== 'available');
  if (!pending.length) return null;

  return (
    <Group label="Translation packs — one click each">
      {pending.map(({ from, to }) => {
        const key = `${from}>${to}`;
        return (
          <div key={key} className="flex items-center gap-2 px-2 py-0.5 text-xs">
            <span className="font-mono">
              {from} → {to}
            </span>
            <span className="text-dim">{status[key] ?? '…'}</span>
            <button onClick={() => void download_(from, to)} className="btn btn-sm ml-auto">
              Download
            </button>
          </div>
        );
      })}
    </Group>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="menu-group">
      <p className="menu-label">{label}</p>
      {children}
    </div>
  );
}
