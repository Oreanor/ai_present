'use client';

import { useEffect, useState } from 'react';
import { download, exportAll, flaggedMarkdown, fullMarkdown } from '@/lib/export';
import { requiredPairs, transcriptLangs } from '@/lib/profile';
import { getTranslator, pairAvailability } from '@/lib/speech/translator';
import { useStore } from '@/lib/store';
import { HOTKEY_HELP } from '@/lib/hotkeys';
import { setTheme, setUiLang, THEMES, UI_LANGS, useT, type Theme, type UiLang } from '@/lib/ui-prefs';
import type { Lang } from '@/lib/types';

/**
 * Всё, чем не пользуются во время выступления.
 *
 * Здесь осталось только то, чему нет альтернативы: окно показа не нужно —
 * шарится это же окно целиком, компоновку субтитров приложение выбирает
 * само по форме колоды, а демо — инструмент разработки, не функция.
 */
export function ControlMenu({
  onClose,
  theme,
  uiLang,
  used,
  geminiInUse,
  onOpenWizard,
}: {
  onClose: () => void;
  theme: Theme;
  uiLang: UiLang;
  used: number;
  geminiInUse: boolean;
  onOpenWizard: () => void;
}) {
  const state = useStore();
  const t = useT();

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="menu">
        <PackList />

        <Group label={t('appearance')}>
          <div className="flex gap-1">
            {THEMES.map((v) => (
              <button
                key={v.id}
                onClick={() => setTheme(v.id)}
                className={`btn btn-sm flex-1 ${theme === v.id ? 'btn-on' : ''}`}
              >
                {t(v.key)}
              </button>
            ))}
          </div>
        </Group>

        {/* Язык КНОПОК, не язык встречи. Их легко перепутать, поэтому
            блоки разные и подписи разные. */}
        <Group label={t('interfaceLanguage')}>
          <div className="flex gap-1">
            {UI_LANGS.map((v) => (
              <button
                key={v.id}
                onClick={() => setUiLang(v.id)}
                className={`btn btn-sm flex-1 ${uiLang === v.id ? 'btn-on' : ''}`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </Group>

        <Group label={t('export')}>
          <button
            className="menu-item"
            onClick={() => download('log-full.md', fullMarkdown(state.entries, state.profile))}
          >
            {t('fullLog')}
          </button>
          <button
            className="menu-item"
            onClick={() => download('follow-up.md', flaggedMarkdown(state.entries, transcriptLangs(state.profile)[0]))}
          >
            {t('flaggedOnly')}
          </button>
          <button className="menu-item" onClick={() => exportAll(state.entries, state.profile)}>
            {t('perLanguage')}
          </button>
        </Group>

        <Group label={t('session')}>
          <button
            className="menu-item text-err"
            onClick={() => {
              if (confirm(t('clearLogConfirm'))) state.clearLog();
            }}
          >
            {t('clearLog')}
          </button>
          <button className="menu-item" onClick={onOpenWizard}>
            {t('languagesSetup')}
          </button>
          {geminiInUse ? (
            <p className="px-2 py-1 text-[11px] text-dim">
              {t('requestsUsed')}: {used}
            </p>
          ) : null}
        </Group>

        <Group label={t('keyboard')}>
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
  const t = useT();
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
    <Group label={t('packs')}>
      {pending.map(({ from, to }) => {
        const key = `${from}>${to}`;
        return (
          <div key={key} className="flex items-center gap-2 px-2 py-0.5 text-xs">
            <span className="font-mono">
              {from} → {to}
            </span>
            <span className="text-dim">{status[key] ?? '…'}</span>
            <button onClick={() => void download_(from, to)} className="btn btn-sm ml-auto">
              {t('download')}
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
