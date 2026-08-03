'use client';

import { useSyncExternalStore } from 'react';

// Настройки самого интерфейса: тема и язык. Отдельно от MeetingProfile —
// там языки ВСТРЕЧИ, здесь язык кнопок. Их легко перепутать, но это
// разные вещи: португалец может вести встречу по-английски и хотеть
// португальские подписи, и наоборот.

export type Theme = 'dark' | 'light';
/** Язык интерфейса. Английский — общий для всех; португальский — потому
 *  что коллеги, для которых это писалось, читают на нём. */
export type UiLang = 'en' | 'pt';

const K = { theme: 'aip.theme', uiLang: 'aip.uiLang' };

let theme: Theme = 'dark';
let uiLang: UiLang = 'en';
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function initUiPrefs(): void {
  if (typeof localStorage === 'undefined') return;
  const t = localStorage.getItem(K.theme);
  // Если пользователь не выбирал — идём за системной настройкой.
  theme = t === 'light' || t === 'dark' ? t : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const l = localStorage.getItem(K.uiLang);
  uiLang = l === 'pt' ? 'pt' : 'en';
  applyTheme();
  emit();
}

function applyTheme(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

export function setTheme(t: Theme): void {
  theme = t;
  localStorage.setItem(K.theme, t);
  applyTheme();
  emit();
}

export function setUiLang(l: UiLang): void {
  uiLang = l;
  localStorage.setItem(K.uiLang, l);
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => theme,
    () => 'dark' as Theme,
  );
}

export function useUiLang(): UiLang {
  return useSyncExternalStore(
    subscribe,
    () => uiLang,
    () => 'en' as UiLang,
  );
}

// --- словарь ---------------------------------------------------------------
// Строки собраны в одном месте, чтобы добавление языка было правкой файла,
// а не раскопками по компонентам.

const DICT = {
  startListening: { en: 'Start listening', pt: 'Começar a ouvir' },
  stopListening: { en: 'Stop listening', pt: 'Parar de ouvir' },
  me: { en: 'me', pt: 'eu' },
  room: { en: 'room', pt: 'sala' },
  readIn: { en: 'Read in', pt: 'Ler em' },
  captionsHidden: { en: 'Captions HIDDEN', pt: 'Legendas OCULTAS' },
  dropPdf: { en: 'Drop your PDF here', pt: 'Solte o seu PDF aqui' },
  orClick: { en: 'or click to choose', pt: 'ou clique para escolher' },
  onScreen: { en: 'On screen', pt: 'No ecrã' },
  questionFromRoom: { en: 'Question from the room', pt: 'Pergunta da sala' },
  nothingYet: { en: 'Nothing said yet.', pt: 'Ainda nada foi dito.' },
  nothingInLog: { en: 'Nothing said yet.', pt: 'Ainda nada foi dito.' },
  export: { en: 'Export', pt: 'Exportar' },
  settings: { en: 'Settings', pt: 'Definições' },
  theme: { en: 'Appearance', pt: 'Aparência' },
  dark: { en: 'Dark', pt: 'Escuro' },
  light: { en: 'Light', pt: 'Claro' },
  interfaceLanguage: { en: 'Interface language', pt: 'Idioma da interface' },
  shareWindow: { en: 'The window you share in Teams', pt: 'A janela que partilha no Teams' },
  openPresentation: { en: 'Open the presentation window', pt: 'Abrir a janela de apresentação' },
  arrangeWindows: { en: 'Place both windows side by side', pt: 'Colocar as janelas lado a lado' },
  captionLayout: { en: 'Caption layout', pt: 'Disposição das legendas' },
  rehearse: { en: 'Rehearse without a microphone', pt: 'Ensaiar sem microfone' },
  playDemo: { en: '▶ Play a recorded demo', pt: '▶ Reproduzir demonstração' },
  stopDemo: { en: '■ Stop demo playback', pt: '■ Parar demonstração' },
  fullLog: { en: 'Full log with originals', pt: 'Registo completo com originais' },
  flaggedOnly: { en: 'Flagged items only', pt: 'Apenas itens marcados' },
  session: { en: 'Session', pt: 'Sessão' },
  clearLog: { en: 'Clear the log', pt: 'Limpar o registo' },
  languagesSetup: { en: 'Languages and setup…', pt: 'Idiomas e configuração…' },
  keyboard: { en: 'Keyboard', pt: 'Teclado' },
  packs: { en: 'Translation packs — one click each', pt: 'Pacotes de tradução — um clique cada' },
  download: { en: 'Download', pt: 'Descarregar' },
  clickForOther: { en: 'Click to see the other language and the original', pt: 'Clique para ver o outro idioma e o original' },
  fixText: { en: 'Fix text', pt: 'Corrigir texto' },
  flagForFollowUp: { en: 'Flag for follow-up', pt: 'Marcar para seguimento' },
  slide: { en: 'slide', pt: 'diapositivo' },
  saidIn: { en: 'said in', pt: 'dito em' },
  latest: { en: '↓ Latest', pt: '↓ Recentes' },
} as const;

export type StringKey = keyof typeof DICT;

export function useT(): (k: StringKey) => string {
  const lang = useUiLang();
  return (k) => DICT[k][lang] ?? DICT[k].en;
}
