'use client';

import { useEffect, useState } from 'react';
import { download, exportAll, fullMarkdown, transcriptMarkdown } from '@/lib/export';
import { presenterLangOf, requiredPairs } from '@/lib/profile';
import { commandHelp } from '@/lib/voice-commands';
import { getTranslator, pairAvailability } from '@/lib/speech/translator';
import { shownLang, useStore } from '@/lib/store';
import { HOTKEY_HELP } from '@/lib/hotkeys';
import { setTheme, setUiLang, THEMES, UI_LANGS, useT, type Theme, type UiLang } from '@/lib/ui-prefs';
import { LANG_NAMES, type Lang } from '@/lib/types';

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
  onOpenWizard,
}: {
  onClose: () => void;
  theme: Theme;
  uiLang: UiLang;
  onOpenWizard: () => void;
}) {
  const state = useStore();
  const t = useT();
  const shown = shownLang(state);

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="menu">
        <PackList />

        <Group label={t('session')} defaultOpen>
          {/* Без подтверждения: системное окно всплывает поверх расшаренного
              экрана, и его видит зал. Пункт лежит под «⋯», куда во время
              доклада не заходят, а перед очисткой рядом лежит выгрузка. */}
          <button className="menu-item text-err" onClick={state.clearLog}>
            {t('clearLog')}
          </button>
          <button className="menu-item" onClick={onOpenWizard}>
            {t('languagesSetup')}
          </button>
        </Group>

        <Group label={t('appearance')} defaultOpen>
          <InlineChoice
            label={t('theme')}
            value={theme}
            options={THEMES.map((v) => ({ id: v.id, label: t(v.key) }))}
            onPick={setTheme}
          />
          {/* Язык КНОПОК, не язык встречи. Их легко перепутать, поэтому
              подписи у строк разные и явные. */}
          <InlineChoice
            label={t('interfaceLanguage')}
            value={uiLang}
            options={UI_LANGS.map((v) => ({ id: v.id, label: v.label }))}
            onPick={setUiLang}
          />
        </Group>

        {/* Выгрузка идёт на том языке, который выбран в «Ler em»: лог читают
            и раздают на нём же, и получить файл на другом языке было бы
            неожиданностью. Полная выгрузка с оригиналами и обе стенограммы
            от выбора не зависят — там языки все. */}
        <Group label={t('export')}>
          <button
            className="menu-item"
            onClick={() => download(`transcript-${shown}.md`, transcriptMarkdown(state.entries, shown, state.profile))}
          >
            {t('transcriptIn')} · {LANG_NAMES[shown]}
          </button>
          <button className="menu-item" onClick={() => exportAll(state.entries, state.profile)}>
            {t('perLanguage')}
          </button>
          <button
            className="menu-item"
            onClick={() => download('log-full.md', fullMarkdown(state.entries, state.profile))}
          >
            {t('fullLog')}
          </button>
        </Group>

        <Group label={t('voiceCommands')}>
          {commandHelp(presenterLangOf(state.profile), { deckOpen: state.docId !== '' }).map((c) => (
            // Фразу не переносим: «мне английский» ломалось на две строки и
            // читалось как две разных команды. Переносится пусть подпись.
            <div key={c.phrase} className="flex justify-between gap-3 px-2 py-0.5 text-[11px]">
              <span className="shrink-0 whitespace-nowrap font-mono text-accent">{c.phrase}</span>
              <span className="text-right text-dim">{t(c.label)}</span>
            </div>
          ))}
          <p className="px-2 pt-1 text-[10px] leading-snug text-dim">{t('voiceLangNote')}</p>
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
  /**
   * null — ещё не спрашивали. Именно null, а не пустой словарь: пустой
   * означал бы «ни один пакет не скачан», и на открытии меню раздел успевал
   * показать все пары разом, а через миг схлопывался до настоящих недостающих
   * (обычно — ни одной). Меню моргало и прыгало содержимым прямо под курсором.
   * Опрос занимает миллисекунды, так что подождать его дешевле, чем соврать.
   */
  const [status, setStatus] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const { from, to } of pairs) next[`${from}>${to}`] = await pairAvailability(from, to);
      // Ответы поверх известного, а не наоборот: пока шёл опрос, пользователь
      // мог нажать «Скачать», и его downloading затирать нельзя.
      if (!cancelled) setStatus((prev) => ({ ...next, ...(prev ?? {}) }));
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

  if (!status) return null;
  const pending = pairs.filter(({ from, to }) => status[`${from}>${to}`] !== 'available');
  if (!pending.length) return null;

  // Развёрнут сразу: этот раздел появляется, только когда пакета не хватает,
  // и свёрнутый он выглядел бы как ещё один справочник, а не как поломка,
  // из-за которой перевод сейчас не работает.
  return (
    <Group label={t('packs')} defaultOpen>
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

/**
 * Выбор из двух-трёх вариантов одной строкой: подпись слева, варианты
 * справа. Кнопками во всю ширину с заливкой акцентом это занимало по два
 * ряда на каждую мелочь и кричало громче того, ради чего сюда заходят.
 * Выбранное отмечено цветом и насыщенностью — этого хватает.
 */
function InlineChoice<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onPick: (id: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-2 py-1 text-[11px]">
      <span className="text-dim">{label}</span>
      <div className="flex shrink-0 gap-3">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onPick(o.id)}
            className={o.id === value ? 'font-semibold text-accent' : 'text-dim hover:text-fg'}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Раздел меню, свёрнутый по умолчанию.
 *
 * Развёрнутыми все разом они в окно не помещаются: одни горячие клавиши
 * с голосовыми командами дают полсотни строк, и то, ради чего сюда зашли,
 * оказывалось за нижним краем экрана — без единого признака, что там ещё
 * что-то есть. Заходят сюда всегда за чем-то одним, поэтому цена сворачивания
 * — один клик, а выигрыш — меню целиком видно с первого взгляда.
 */
function Group({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`menu-group ${open ? '' : 'pb-0'}`}>
      <button type="button" className="menu-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{label}</span>
        {/* Шеврон один и тот же, повёрнутый: две разные глифы прыгали бы
            по ширине и дёргали заголовок при каждом нажатии. */}
        <span aria-hidden className="menu-chevron">
          ›
        </span>
      </button>
      {open ? children : null}
    </div>
  );
}
