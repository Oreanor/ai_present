'use client';

import { useEffect } from 'react';
import { routes } from '@/lib/routes';

// Точка входа. Отдельная страница нужна, потому что статическая сборка
// открывается по file://, где роутер Next не работает.
export default function Home() {
  useEffect(() => {
    location.replace(routes.control);
  }, []);

  return (
    <main className="flex h-dvh items-center justify-center">
      <a href={routes.control} className="rounded bg-accent px-4 py-2 font-semibold text-black">
        Open Control
      </a>
    </main>
  );
}
