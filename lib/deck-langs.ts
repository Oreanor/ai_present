import { ALL_LANGS, type Lang } from './types';

/**
 * Язык файла по имени: talk-pt.pdf, talk_ru.pdf, talk.en.pdf.
 *
 * Это подсказка, а не решение. Переводы обычно так и называют, но угадать
 * можно и мимо, поэтому результат идёт в предзаполнение выбора, который
 * человек видит и правит. Молча открыть португальский файл как английский
 * значит показать залу не тот текст и узнать об этом на середине доклада.
 */
export function guessLang(filename: string): Lang | null {
  const stem = filename.replace(/\.pdf$/i, '').toLowerCase();
  for (const l of ALL_LANGS) {
    if (new RegExp(`[-_. ]${l}$`).test(stem)) return l;
  }
  return null;
}

/** Имя без языкового суффикса — под ним колода лежит в галерее. */
export function baseName(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.'));
  const stem = filename.slice(0, filename.lastIndexOf('.')) || filename;
  return stem.replace(new RegExp(`[-_. ](${ALL_LANGS.join('|')})$`, 'i'), '') + ext;
}
