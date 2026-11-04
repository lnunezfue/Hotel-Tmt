import clsx from 'clsx';
import type { HTMLAttributes } from 'react';

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={clsx('rounded-xl border border-borde bg-white', className)} />;
}
