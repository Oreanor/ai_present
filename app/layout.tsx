import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Presenter — live captions',
  description: 'Slides with live translated captions shared straight into Teams.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Интерфейс на английском — единственный общий язык предполагаемых
  // пользователей (§1).
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
