import type { Entry, Lang, MeetingProfile } from './types';
import { captionLangOf, transcriptLangs } from './profile';
import { LANG_NAMES } from './types';

// Экспорт (§10). Основное, что отдают после встречи, — две одноязычные
// стенограммы. Имена файлов строятся из профиля, не захардкожены.

function stamp(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Полная стенограмма на ОДНОМ языке: все реплики подряд, обеих сторон,
 * хронологически, ни одной фразы на чужом языке — это и делает файл
 * пригодным для отправки участникам (§14.10).
 */
export function transcriptMarkdown(entries: Entry[], lang: Lang, profile: MeetingProfile): string {
  const lines: string[] = [];
  lines.push(`# Meeting transcript — ${LANG_NAMES[lang]}`);
  lines.push('');
  lines.push(`Captions were shown in ${LANG_NAMES[captionLangOf(profile)]}.`);
  lines.push('');

  let lastSlide = -1;
  for (const e of entries.filter((x) => x.isFinal)) {
    const text = e.texts[lang];
    if (!text) continue; // перевод не доехал — пропускаем, чужой язык не вставляем
    if (e.slideIndex !== lastSlide) {
      lines.push('');
      lines.push(`## Slide ${e.slideIndex + 1}`);
      lines.push('');
      lastSlide = e.slideIndex;
    }
    const who = e.speaker === 'presenter' ? 'Presenter' : 'Audience';
    const flag = e.flagged ? ' 🔖' : '';
    lines.push(`- \`${stamp(e.ts)}\` **${who}:** ${text}${flag}`);
  }
  return lines.join('\n') + '\n';
}

/** Отладочный экспорт: обе версии плюс оригинал и origLang каждой реплики. */
export function fullMarkdown(entries: Entry[], profile: MeetingProfile): string {
  const [a, b] = transcriptLangs(profile);
  const lines = ['# Meeting log (full)', ''];
  for (const e of entries.filter((x) => x.isFinal)) {
    const who = e.speaker === 'presenter' ? 'Presenter' : 'Audience';
    lines.push(`### \`${stamp(e.ts)}\` ${who} · slide ${e.slideIndex + 1} · spoken in ${e.origLang}${e.flagged ? ' · 🔖' : ''}`);
    lines.push('');
    lines.push(`- original: ${e.origText}`);
    lines.push(`- ${a}: ${e.texts[a] ?? '—'}`);
    lines.push(`- ${b}: ${e.texts[b] ?? '—'}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function download(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportAll(entries: Entry[], profile: MeetingProfile): void {
  for (const lang of transcriptLangs(profile)) {
    download(`transcript-${lang}.md`, transcriptMarkdown(entries, lang, profile));
  }
}
