'use client';

import { useT } from '@/lib/ui-prefs';

/**
 * Навигация по слайдам прозрачными зонами по краям.
 *
 * Отдельной полосы под слайдом нет — она отбирала у него несколько
 * десятков пикселей высоты постоянно, ради двух кнопок. Зоны не отбирают
 * ничего и проявляются при наведении.
 */
export function EdgeNav({
  side,
  onClick,
  disabled,
}: {
  side: 'left' | 'right';
  onClick: () => void;
  disabled: boolean;
}) {
  const t = useT();
  const dir = side === 'left' ? 90 : 270;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={side === 'left' ? t('hintPrevSlide') : t('hintNextSlide')}
      className={`group absolute inset-y-0 w-16 disabled:pointer-events-none ${side === 'left' ? 'left-0' : 'right-0'}`}
    >
      <span
        className={`absolute inset-0 transition-opacity duration-150 ${
          disabled ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'
        }`}
        style={{ background: `linear-gradient(${dir}deg, rgb(0 0 0 / 0.55), transparent)` }}
      />
      <span
        className={`absolute top-1/2 -translate-y-1/2 text-3xl leading-none text-white transition-opacity ${
          side === 'left' ? 'left-4' : 'right-4'
        } ${disabled ? 'opacity-0' : 'opacity-25 group-hover:opacity-100'}`}
      >
        {side === 'left' ? '‹' : '›'}
      </span>
    </button>
  );
}
