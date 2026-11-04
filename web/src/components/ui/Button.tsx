import clsx from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

type Variante = 'primario' | 'secundario' | 'fantasma';

export function Button({ variante = 'secundario', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return (
    <button
      {...p}
      className={clsx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variante === 'primario' && 'bg-acento text-white hover:bg-acento/90',
        variante === 'secundario' && 'border border-borde bg-white hover:bg-fondo',
        variante === 'fantasma' && 'text-tinta-suave hover:bg-fondo',
        className,
      )}
    />
  );
}
