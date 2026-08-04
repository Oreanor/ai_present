import { ALL_LANGS, type Lang } from './types';

/**
 * Голосовое перелистывание.
 *
 * Слушать команды в общем потоке речи нельзя: слово «дальше» посреди фразы
 * — это слово, а не приказ. Поэтому командой считается только реплика,
 * которая ЦЕЛИКОМ состоит из команды: короткая пауза, одно слово, пауза.
 * Так распознаватель отдаёт её отдельной фразой, и спутать её с речью
 * почти невозможно.
 *
 * Совпавшая реплика в лог не пишется: это управление, а не то, что было
 * сказано залу.
 */
export type VoiceCommand = 'next' | 'prev';

/** Фразы — данными, по одному списку на язык. Добавить язык значит
 *  дописать строку, а не искать условия по коду. */
const PHRASES: Record<Lang, Record<VoiceCommand, string[]>> = {
  en: {
    next: ['next', 'next slide', 'forward', 'go on'],
    prev: ['back', 'go back', 'previous', 'previous slide'],
  },
  ru: {
    next: ['дальше', 'вперёд', 'вперед', 'следующий', 'следующий слайд', 'далее'],
    prev: ['назад', 'обратно', 'предыдущий', 'предыдущий слайд'],
  },
  pt: {
    next: ['próximo', 'proximo', 'seguinte', 'próximo slide', 'avançar', 'avancar'],
    prev: ['anterior', 'voltar', 'atrás', 'atras', 'diapositivo anterior'],
  },
};

/** Длиннее этого команда не бывает, а обычная фраза — сплошь и рядом. */
const MAX_CHARS = 24;

/**
 * Команда, если реплика — это она и только она.
 *
 * Проверяем все языки сразу, а не только распознанный: приколотый к
 * английскому распознаватель, услышав «дальше», отдаст что угодно, и
 * привязка к языку реплики тут только мешала бы. Сами списки не
 * пересекаются, так что ложных срабатываний это не добавляет.
 */
export function matchVoiceCommand(text: string): VoiceCommand | null {
  const clean = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || clean.length > MAX_CHARS) return null;

  for (const lang of ALL_LANGS) {
    for (const cmd of ['next', 'prev'] as VoiceCommand[]) {
      if (PHRASES[lang][cmd].includes(clean)) return cmd;
    }
  }
  return null;
}
