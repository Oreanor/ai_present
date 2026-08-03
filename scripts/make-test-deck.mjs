// Генерирует альбомный тестовый PDF 16:9 без внешних зависимостей.
// Нужен, чтобы проверять рендер, навигацию и разметку без реальной колоды.
import { writeFileSync } from 'node:fs';

const W = 960;
const H = 540;
const PAGES = 12;

const objects = [];
const add = (body) => {
  objects.push(body);
  return objects.length; // номера объектов с 1
};

const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

const contentIds = [];
for (let i = 1; i <= PAGES; i++) {
  const stream = [
    '0.08 0.10 0.14 rg',
    `0 0 ${W} ${H} re f`,
    '0.42 0.66 1 rg',
    `60 ${H - 120} 220 8 re f`,
    'BT /F1 54 Tf 1 1 1 rg 60 ' + (H - 220) + ' Td (Slide ' + i + ') Tj ET',
    'BT /F1 22 Tf 0.6 0.65 0.75 rg 60 ' + (H - 270) + ' Td (Landscape 16:9 test deck) Tj ET',
    'BT /F1 18 Tf 0.35 0.4 0.5 rg 60 60 Td (Kubernetes deployment pipeline across three regions) Tj ET',
    '0.25 0.28 0.36 rg',
    `${W - 260} 60 200 ${H - 340} re f`,
  ].join('\n');
  contentIds.push(add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`));
}

const pagesId = objects.length + PAGES + 1;
const pageIds = [];
for (let i = 0; i < PAGES; i++) {
  pageIds.push(
    add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`,
    ),
  );
}
const realPagesId = add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${PAGES} >>`);
const catalogId = add(`<< /Type /Catalog /Pages ${realPagesId} 0 R >>`);

// Ссылка на /Parent писалась до того, как стал известен id — чиним.
for (const i of pageIds) objects[i - 1] = objects[i - 1].replace(/\/Parent \d+ 0 R/, `/Parent ${realPagesId} 0 R`);

let out = '%PDF-1.4\n';
const offsets = [0];
objects.forEach((body, idx) => {
  offsets.push(out.length);
  out += `${idx + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = out.length;
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (let i = 1; i <= objects.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

writeFileSync('test-deck.pdf', out, 'latin1');
console.log(`test-deck.pdf: ${PAGES} pages, ${W}x${H}`);
