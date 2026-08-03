// Путь B — серверный ключ (§5). Существует ТОЛЬКО в обычной сборке;
// статический экспорт этот route исключает, и клиент уходит на путь A.
//
// По умолчанию выключен: публичный адрес с ключом владельца в .env — это
// приглашение первому же случайному посетителю сжечь суточный лимит.
// Включается явной переменной GEMINI_SERVER_KEY_ENABLED=1.

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Rate limiting обязателен и здесь: залипший VAD способен сжечь лимит
// за минуту одинаково успешно с любой стороны.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 40;
const hits: number[] = [];

function rateLimited(): boolean {
  const now = Date.now();
  while (hits.length && now - hits[0] > WINDOW_MS) hits.shift();
  if (hits.length >= MAX_PER_WINDOW) return true;
  hits.push(now);
  return false;
}

export async function POST(req: Request): Promise<Response> {
  if (process.env.GEMINI_SERVER_KEY_ENABLED !== '1') {
    return Response.json(
      { error: 'Server-side key is disabled. Enter your own key in the app settings.' },
      { status: 501 },
    );
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: 'GEMINI_API_KEY is not configured.' }, { status: 500 });

  if (rateLimited()) return Response.json({ error: 'Too many requests.' }, { status: 429 });

  const body = await req.text();
  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
