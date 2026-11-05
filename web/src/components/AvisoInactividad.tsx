import { useEffect, useRef, useState } from 'react';

function segundosRestantes(cierreEn: number) {
  return Math.max(0, Math.ceil((cierreEn - Date.now()) / 1000));
}

export function AvisoInactividad({ cierreEn, onSeguir }: { cierreEn: number; onSeguir: () => void }) {
  const [segundos, setSegundos] = useState(() => segundosRestantes(cierreEn));
  const boton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    boton.current?.focus();
  }, []);

  useEffect(() => {
    setSegundos(segundosRestantes(cierreEn));
    const id = setInterval(() => setSegundos(segundosRestantes(cierreEn)), 1000);
    return () => clearInterval(id);
  }, [cierreEn]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="aviso-inactividad-titulo" aria-describedby="aviso-inactividad-texto" className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-8 shadow-xl">
        <h2 id="aviso-inactividad-titulo" className="text-xl font-bold">¿Sigues ahí?</h2>
        <p id="aviso-inactividad-texto" className="text-sm text-tinta-suave">Tu sesión se cerrará en {segundos} s por inactividad.</p>
        <button ref={boton} type="button" onClick={onSeguir} className="h-10 rounded-lg bg-lateral px-4 text-sm font-semibold text-white hover:opacity-90">
          Seguir trabajando
        </button>
      </div>
    </div>
  );
}
