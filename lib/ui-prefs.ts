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

/**
 * Варианты — данные, а не разметка. Кнопки строятся перебором, поэтому
 * добавление языка или темы это правка одного массива, а не поиск
 * тернарников по компонентам.
 *
 * Подписи языков намеренно НЕ переводятся: «Português» должен читаться
 * как «Português» и в английском интерфейсе тоже, иначе человек не найдёт
 * свой язык в списке.
 */
export const UI_LANGS: { id: UiLang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'pt', label: 'Português' },
];

export const THEMES: { id: Theme; key: StringKey }[] = [
  { id: 'dark', key: 'themeDark' },
  { id: 'light', key: 'themeLight' },
];

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
  appearance: { en: 'Appearance', pt: 'Aparência' },
  themeDark: { en: 'Dark', pt: 'Escuro' },
  themeLight: { en: 'Light', pt: 'Claro' },
  interfaceLanguage: { en: 'Interface language', pt: 'Idioma da interface' },
  shareWindow: { en: 'The window you share in Teams', pt: 'A janela que partilha no Teams' },
  openPresentation: { en: 'Open the presentation window', pt: 'Abrir a janela de apresentação' },
  fullLog: { en: 'Full log with originals', pt: 'Registo completo com originais' },
  flaggedOnly: { en: 'Flagged items only', pt: 'Apenas itens marcados' },
  session: { en: 'Session', pt: 'Sessão' },
  clearLog: { en: 'Clear the log', pt: 'Limpar o registo' },
  clearLogConfirm: {
    en: 'Erase the whole log? Export it first if you need it.',
    pt: 'Apagar todo o registo? Exporte primeiro se precisar dele.',
  },
  languagesSetup: { en: 'Languages and setup…', pt: 'Idiomas e configuração…' },
  keyboard: { en: 'Keyboard', pt: 'Teclado' },
  packs: { en: 'Translation packs — one click each', pt: 'Pacotes de tradução — um clique cada' },
  download: { en: 'Download', pt: 'Descarregar' },
  requestsUsed: { en: 'Gemini requests used', pt: 'Pedidos Gemini usados' },
  menuHint: { en: 'Everything you do not need mid-talk', pt: 'Tudo o que não precisa durante a apresentação' },

  // --- мастер настройки ---
  setupTitle: { en: 'Set up this meeting', pt: 'Configurar esta reunião' },
  setupLead: {
    en: 'Everything below is stored on this machine only. Nothing is sent anywhere until you start a session.',
    pt: 'Tudo isto fica guardado apenas neste computador. Nada é enviado até iniciar uma sessão.',
  },
  languages: { en: 'Languages', pt: 'Idiomas' },
  iSpeak: { en: 'I speak', pt: 'Eu falo' },
  audienceSpeaks: { en: 'The audience speaks', pt: 'A audiência fala' },
  captionsShownIn: { en: 'Captions shown in', pt: 'Legendas mostradas em' },
  transcriptsIn: { en: 'Two transcripts in', pt: 'Duas transcrições em' },

  howLangDecided: { en: 'How the language is decided', pt: 'Como o idioma é determinado' },
  howLangLead: {
    en: 'This choice decides the engine, and the difference is bigger than it looks.',
    pt: 'Esta escolha determina o motor, e a diferença é maior do que parece.',
  },
  colPin: { en: 'Pin — you say which language', pt: 'Fixo — você indica o idioma' },
  colAuto: { en: 'Auto — the engine decides', pt: 'Auto — o motor decide' },
  rowDelay: { en: 'Caption delay', pt: 'Atraso das legendas' },
  rowPartial: { en: 'Live partial text', pt: 'Texto parcial ao vivo' },
  rowLimits: { en: 'Daily limits', pt: 'Limites diários' },
  rowKey: { en: 'API key', pt: 'Chave API' },
  rowOffline: { en: 'Works offline', pt: 'Funciona offline' },
  rowRemember: { en: 'You must remember', pt: 'Tem de lembrar-se' },
  valYes: { en: 'yes', pt: 'sim' },
  valNo: { en: 'no', pt: 'não' },
  valNone: { en: 'none at all', pt: 'nenhum' },
  valSharedQuota: { en: 'shared Gemini quota', pt: 'quota Gemini partilhada' },
  valNotNeeded: { en: 'not needed', pt: 'não necessária' },
  valRequired: { en: 'required', pt: 'necessária' },
  valPartly: { en: 'partly', pt: 'parcialmente' },
  valPressL: { en: 'press L before switching', pt: 'premir L antes de mudar' },
  valNothing: { en: 'nothing', pt: 'nada' },

  microphone: { en: 'Microphone', pt: 'Microfone' },
  roomAudio: { en: 'Room audio', pt: 'Áudio da sala' },
  modePin: { en: 'Pin', pt: 'Fixo' },
  modeAuto: { en: 'Auto', pt: 'Auto' },

  apiKeyTitle: { en: 'Gemini API key', pt: 'Chave API Gemini' },
  apiKeyLead: {
    en: 'Needed because at least one channel is on auto-detect. Stored in this browser only, never sent anywhere but Google. Pin both channels and this section disappears.',
    pt: 'Necessária porque pelo menos um canal está em deteção automática. Guardada apenas neste navegador, nunca enviada para outro lado além da Google. Fixe ambos os canais e esta secção desaparece.',
  },
  keyKind: { en: 'What kind of key is it?', pt: 'Que tipo de chave é?' },
  tierFree: { en: 'Free', pt: 'Gratuita' },
  tierFreeHint: { en: '~10 req/min, ~250 a day', pt: '~10 ped./min, ~250 por dia' },
  tierPaid: { en: 'Billing enabled', pt: 'Faturação ativa' },
  tierPaidHint: { en: 'hundreds per minute', pt: 'centenas por minuto' },
  quotaNote: {
    en: 'A free key allows roughly ten requests a minute. Two hours of your own speech needs about six hundred — which is why the microphone should stay pinned and only the room audio should use Gemini.',
    pt: 'Uma chave gratuita permite cerca de dez pedidos por minuto. Duas horas da sua fala precisam de cerca de seiscentos — por isso o microfone deve ficar fixo e só o áudio da sala deve usar Gemini.',
  },
  capLabel: { en: 'Never send more than', pt: 'Nunca enviar mais de' },
  capSuffix: { en: 'requests — a hard stop, roughly', pt: 'pedidos — paragem forçada, cerca de' },
  capNote: {
    en: "This is the only limit that actually stops anything. Google's budget alerts arrive after the fact. For a second line of defence, set a quota override on the project in the Cloud console.",
    pt: 'Este é o único limite que realmente pára alguma coisa. Os alertas de orçamento da Google chegam depois do facto. Como segunda defesa, defina um limite de quota no projeto na consola Cloud.',
  },

  preflight: { en: 'Preflight', pt: 'Verificação prévia' },
  checkProfile: { en: 'Profile is consistent', pt: 'Perfil é coerente' },
  checkWebSpeech: { en: 'Web Speech available', pt: 'Web Speech disponível' },
  checkWebSpeechHint: { en: 'Needed for pinned channels.', pt: 'Necessário para canais fixos.' },
  checkTranslator: { en: 'Translator API available', pt: 'API Translator disponível' },
  checkTranslatorHint: { en: 'On-device translation.', pt: 'Tradução no dispositivo.' },
  checkKey: { en: 'Gemini key entered', pt: 'Chave Gemini introduzida' },
  checkShare: { en: 'Share the WINDOW, not the screen', pt: 'Partilhe a JANELA, não o ecrã' },
  checkShareHint: {
    en: 'Sharing the whole screen shows the audience your log, and you would not notice.',
    pt: 'Partilhar o ecrã inteiro mostra o seu registo à audiência, e não daria por isso.',
  },
  packOneAtATime: {
    en: 'Download one pack at a time — each needs its own click, that is a browser rule.',
    pt: 'Descarregue um pacote de cada vez — cada um precisa do seu clique, é uma regra do navegador.',
  },
  worthKnowing: { en: 'Worth knowing', pt: 'Vale a pena saber' },
  start: { en: 'Start', pt: 'Começar' },

  // --- проблемы профиля (ключи из lib/profile.ts) ---
  needPresenterLang: { en: 'Pick at least one language you speak.', pt: 'Escolha pelo menos um idioma que fala.' },
  needAudienceLang: {
    en: 'Pick at least one language the audience speaks.',
    pt: 'Escolha pelo menos um idioma que a audiência fala.',
  },
  captionNotInTranscripts: {
    en: 'Caption language must be one of the two transcript languages.',
    pt: 'O idioma das legendas tem de ser um dos dois idiomas das transcrições.',
  },
  transcriptsSame: {
    en: 'The two transcripts must be in different languages.',
    pt: 'As duas transcrições têm de ser em idiomas diferentes.',
  },
  autoWithOneLang: {
    en: 'Only one language to detect — pin it instead. Faster, and costs nothing.',
    pt: 'Só há um idioma a detetar — fixe-o. É mais rápido e não custa nada.',
  },
  pinnedNotInList: {
    en: 'The pinned language is not in the list above.',
    pt: 'O idioma fixado não está na lista acima.',
  },
  autoOnMicIsExpensive: {
    en: 'Auto-detect on the microphone means about six hundred Gemini requests per two-hour talk, which likely exceeds the free daily quota. Captions also get roughly twenty times slower. Pin the language unless you really switch mid-sentence.',
    pt: 'Deteção automática no microfone significa cerca de seiscentos pedidos Gemini por duas horas de apresentação, o que provavelmente excede a quota diária gratuita. As legendas ficam cerca de vinte vezes mais lentas. Fixe o idioma a não ser que mude mesmo a meio da frase.',
  },
  clickForOther: { en: 'Click to see the other language and the original', pt: 'Clique para ver o outro idioma e o original' },
  fixText: { en: 'Fix text', pt: 'Corrigir texto' },
  flagForFollowUp: { en: 'Flag for follow-up', pt: 'Marcar para seguimento' },
  slide: { en: 'slide', pt: 'diapositivo' },
  saidIn: { en: 'said in', pt: 'dito em' },
  latest: { en: '↓ Latest', pt: '↓ Recentes' },

  // --- подсказки, объясняющие ПОСЛЕДСТВИЕ, а не название кнопки ---
  hintListen: {
    en: 'Listen to my microphone and the meeting audio at the same time',
    pt: 'Ouvir o meu microfone e o áudio da reunião ao mesmo tempo',
  },
  hintStop: {
    en: 'Stop listening to both the microphone and the meeting',
    pt: 'Parar de ouvir o microfone e a reunião',
  },
  hintMicLang: {
    en: 'Which language I am speaking right now. Press before you switch. Shortcut: L',
    pt: 'Que idioma estou a falar agora. Prima antes de mudar. Atalho: L',
  },
  hintElapsed: { en: 'Time since this window was opened', pt: 'Tempo desde que esta janela foi aberta' },
  hintCaptionsBack: { en: 'Press H to bring them back', pt: 'Prima H para as trazer de volta' },
  hintPrevSlide: { en: 'Previous slide (←)', pt: 'Diapositivo anterior (←)' },
  hintNextSlide: { en: 'Next slide (→)', pt: 'Diapositivo seguinte (→)' },
  hintKeptIn: { en: 'Kept in this language — switches instantly', pt: 'Guardado neste idioma — muda instantaneamente' },
  hintTranslateAll: {
    en: 'Translate the whole conversation into this language on this device',
    pt: 'Traduzir toda a conversa para este idioma neste dispositivo',
  },

  // --- окно показа ---
  presentationWindow: { en: 'Presentation window', pt: 'Janela de apresentação' },
  dropSamePdf: { en: 'Drop the same PDF here.', pt: 'Solte aqui o mesmo PDF.' },
  connectedToControl: { en: 'Connected to Control.', pt: 'Ligado ao Control.' },

  // --- сообщения действий ---
  micNowIs: { en: 'Microphone is now', pt: 'O microfone está agora em' },
  nothingToSwitch: {
    en: 'Language is detected automatically — nothing to switch.',
    pt: 'O idioma é detetado automaticamente — nada a mudar.',
  },
  micEngine: { en: 'Microphone engine', pt: 'Motor do microfone' },
  clearAllShapesConfirm: {
    en: 'Erase annotations on every slide?',
    pt: 'Apagar as anotações de todos os diapositivos?',
  },
  fixTextPrompt: { en: 'Fix the text', pt: 'Corrigir o texto' },
} as const;

export type StringKey = keyof typeof DICT;

export function useT(): (k: StringKey) => string {
  const lang = useUiLang();
  return (k) => DICT[k][lang] ?? DICT[k].en;
}
