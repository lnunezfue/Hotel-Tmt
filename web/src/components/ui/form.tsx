import clsx from 'clsx';
import { useEffect, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

const control = 'h-9 w-full rounded-lg border border-borde bg-white px-3 text-sm disabled:bg-fondo disabled:text-tinta-suave';

export function Campo({ etiqueta, ayuda, children, className }: { etiqueta: string; ayuda?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('flex flex-col gap-1 text-sm', className)}>
      <span className="font-medium">{etiqueta}</span>
      {children}
      {ayuda && <span className="text-xs text-tinta-suave">{ayuda}</span>}
    </label>
  );
}

export function Entrada({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={clsx(control, className)} />;
}

export function Selector({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={clsx(control, 'px-2', className)} />;
}

export function Aviso({ tipo = 'error', children }: { tipo?: 'error' | 'ok' | 'info'; children: ReactNode }) {
  return (
    <p
      role={tipo === 'error' ? 'alert' : 'status'}
      className={clsx(
        'rounded-lg px-3 py-2 text-sm',
        tipo === 'error' && 'bg-red-50 text-red-700',
        tipo === 'ok' && 'bg-desocupada/10 text-desocupada',
        tipo === 'info' && 'bg-acento-suave text-acento',
      )}
    >
      {children}
    </p>
  );
}

/** Panel lateral para altas y ediciones. Escape cierra. */
export function PanelLateral({ titulo, abierto, onCerrar, children }: { titulo: string; abierto: boolean; onCerrar: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!abierto) return;
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [abierto, onCerrar]);
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-tinta/30" onClick={onCerrar}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          <button onClick={onCerrar} className="text-sm text-tinta-suave hover:text-tinta">Cerrar</button>
        </div>
        {children}
      </aside>
    </div>
  );
}

export function Pestanas<T extends string>({ opciones, valor, onCambio }: { opciones: Array<{ id: T; texto: string }>; valor: T; onCambio: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-borde">
      {opciones.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={valor === o.id}
          onClick={() => onCambio(o.id)}
          className={clsx(
            '-mb-px border-b-2 px-4 py-2 text-sm font-medium',
            valor === o.id ? 'border-acento text-tinta' : 'border-transparent text-tinta-suave hover:text-tinta',
          )}
        >
          {o.texto}
        </button>
      ))}
    </div>
  );
}

export function Pildora({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}>{children}</span>;
}
