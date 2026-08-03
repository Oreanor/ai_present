// Кладёт воркер pdf.js в public/, чтобы он грузился локальным путём.
// Требование ТЗ §11: никаких CDN, приложение обязано работать без сети.
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  'node_modules/pdfjs-dist/build/pdf.worker.mjs',
];

const src = candidates.map((c) => join(root, c)).find((p) => existsSync(p));
if (!src) {
  console.warn('[copy-pdf-worker] воркер не найден — pdf.js ещё не установлен, пропускаю');
  process.exit(0);
}

await mkdir(join(root, 'public'), { recursive: true });
await copyFile(src, join(root, 'public', 'pdf.worker.mjs'));
console.log('[copy-pdf-worker] public/pdf.worker.mjs готов');
