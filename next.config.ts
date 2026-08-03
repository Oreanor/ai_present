import type { NextConfig } from 'next';

// Две цели сборки из одного кода (ТЗ §16):
//   next build                  → обычная, с API routes, для Vercel
//   STATIC_EXPORT=1 next build  → статика, открывается файлом, без сервера
// output:'export' отключает API routes, поэтому это именно две сборки,
// а не один конфиг. Вся логика обязана жить на клиенте, серверные routes —
// только тонкий прокси, прячущий ключ Gemini.
const isStatic = process.env.STATIC_EXPORT === '1';

const config: NextConfig = {
  output: isStatic ? 'export' : undefined,
  // Относительные пути обязательны: статику открывают через file://,
  // где абсолютный /_next/... не разрешается.
  assetPrefix: isStatic ? '.' : undefined,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_STATIC_BUILD: isStatic ? '1' : '',
  },
};

export default config;
