// Словарь терминов — два независимых механизма (§6б), потому что они бьют
// в разные места.

/** 1. Phrase list — влияет на РАСПОЗНАВАНИЕ.
 *  Из текста слайдов берём только похожее на термины: капитализированное
 *  в середине предложения, аббревиатуры, CamelCase. Все слова подряд
 *  раздувают список, и он перестаёт работать.
 *
 *  Оговорка по стеку: Web Speech phrase list не поддерживает вовсе,
 *  так что на микрофонном канале в режиме pin механизм не работает —
 *  остаётся только глоссарий замен ниже. */
export function extractTerms(pageTexts: string[]): string[] {
  const found = new Map<string, number>();

  for (const text of pageTexts) {
    if (!text) continue;
    // Разбиваем на предложения, чтобы отличать «первое слово» от «в середине».
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const words = sentence.split(/\s+/).filter(Boolean);
      words.forEach((raw, i) => {
        const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if (w.length < 3 || w.length > 32) return;
        if (/^\d+$/.test(w)) return;

        const isAcronym = /^[\p{Lu}]{2,}$/u.test(w);
        const isCamel = /^[\p{Lu}][\p{Ll}]+(?:[\p{Lu}][\p{Ll}]*)+$/u.test(w);
        const isMidCap = i > 0 && /^[\p{Lu}]/u.test(w);

        if (isAcronym || isCamel || isMidCap) found.set(w, (found.get(w) ?? 0) + 1);
      });
    }
  }

  return [...found.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 300)
    .map(([w]) => w);
}

export type GlossaryEntry = { from: string; to: string };

/** 2. Глоссарий замен — влияет на ПЕРЕВОД.
 *  Phrase list смещает только распознавание: «Kubernetes» будет услышан
 *  правильно, а переведён как попало. При выбранном стеке это вообще
 *  единственный рычаг на перевод — Chrome Translator настройке не поддаётся. */
export function applyGlossary(text: string, glossary: GlossaryEntry[]): string {
  let out = text;
  for (const { from, to } of glossary) {
    if (!from.trim() || !to.trim()) continue;
    // \b не работает для кириллицы в некоторых движках — используем
    // явные границы по не-буквам.
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'giu'), (_m, a, b) => `${a}${to}${b}`);
  }
  return out;
}
