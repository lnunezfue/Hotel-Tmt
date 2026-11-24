import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import type { PasoRecorrido } from './servidor';
import { useSesion } from '../features/auth/sesion';

/** El proceso de un día en el hotel, en el orden en que ocurre. */
const PASOS: Array<{ id: PasoRecorrido; titulo: string; como: string; ir: string; boton: string }> = [
  { id: 'caja', titulo: 'Abrir la caja', como: 'Al empezar el turno: «Abrir caja» con el sencillo del cajón.', ir: '/caja', boton: 'Ir a Caja' },
  { id: 'reserva', titulo: 'Reservar para una familia', como: '«+ Nueva reserva» → llegada hoy → dos habitaciones con «+ Agregar otra habitación» → adelanto con Yape.', ir: '/reservas', boton: 'Ir a Reservas' },
  { id: 'checkin', titulo: 'Recibir a los huéspedes', como: 'En «Llegan hoy» abre la reserva, agrega acompañantes y pulsa «Hacer check-in».', ir: '/reservas', boton: 'Ir a Reservas' },
  { id: 'consumo', titulo: 'Anotar un consumo', como: 'En el tablero o el plano, abre una habitación ocupada → «Ver cuenta» → «+ Agregar» (agua, desayuno…).', ir: '/', boton: 'Ir al Tablero' },
  { id: 'checkout', titulo: 'Check-out y cobro', como: '«Check-out y cobrar»: elige boleta, paga en efectivo (calcula el vuelto) o divide con Yape. Sale el comprobante.', ir: '/', boton: 'Ir al Tablero' },
  { id: 'limpieza', titulo: 'Terminar la limpieza', como: 'La habitación quedó «En limpieza». En el tablero, ábrela y pulsa «Marcar disponible».', ir: '/', boton: 'Ir al Tablero' },
  { id: 'cierre', titulo: 'Cerrar la caja', como: 'Al final del turno: cuenta el efectivo, escríbelo y el sistema dice si cuadra, falta o sobra.', ir: '/caja', boton: 'Ir a Caja' },
];

/** Recorrido guiado de la demostración web: muestra el proceso completo y marca cada paso cuando se hace. */
export function AvisoDemo() {
  const qc = useQueryClient();
  const [hecho, setHecho] = useState<Partial<Record<PasoRecorrido, boolean>>>({});
  const [abierto, setAbierto] = useState(() => {
    try {
      return localStorage.getItem('hotel-demo-recorrido') !== 'cerrado' && window.innerWidth >= 768;
    } catch {
      return window.innerWidth >= 768;
    }
  });
  useEffect(() => {
    let vivo = true;
    const leer = async () => {
      const { progresoRecorrido } = await import('./servidor');
      if (vivo) setHecho(progresoRecorrido());
    };
    void leer();
    window.addEventListener('demo-cambio', leer);
    return () => {
      vivo = false;
      window.removeEventListener('demo-cambio', leer);
    };
  }, []);
  const alternar = () => {
    setAbierto(!abierto);
    try {
      localStorage.setItem('hotel-demo-recorrido', abierto ? 'cerrado' : 'abierto');
    } catch {
      // sin almacenamiento
    }
  };
  async function reiniciar() {
    const { reiniciarDemo } = await import('./servidor');
    reiniciarDemo();
    qc.clear();
    location.hash = '#/';
    location.reload();
  }
  const { data: sesion } = useSesion();
  const hechos = PASOS.filter((p) => hecho[p.id]).length;
  const siguiente = PASOS.find((p) => !hecho[p.id]);
  if (!sesion) return null;

  return (
    <div className="fixed bottom-3 left-3 z-30 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-xl bg-tinta text-white shadow-2xl print:hidden">
      <button onClick={alternar} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left" aria-expanded={abierto}>
        <span>
          <span className="block text-sm font-semibold">Recorrido guiado · {hechos}/{PASOS.length}</span>
          <span className="block text-[11px] text-white/70">Demostración con datos de ejemplo</span>
        </span>
        <span className="text-white/70">{abierto ? '▾' : '▴'}</span>
      </button>
      <div className="h-1 bg-white/10"><div className="h-full bg-acento transition-all" style={{ width: `${(hechos / PASOS.length) * 100}%` }} /></div>
      {abierto && (
        <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto bg-white p-2 text-tinta">
          {PASOS.map((p, i) => {
            const actual = p.id === siguiente?.id;
            return (
              <div key={p.id} className={clsx('flex gap-3 rounded-lg p-2', actual && 'bg-acento-suave/60')}>
                <span className={clsx('mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-bold', hecho[p.id] ? 'bg-desocupada text-white' : actual ? 'bg-acento text-white' : 'bg-fondo text-tinta-suave')}>
                  {hecho[p.id] ? '✓' : i + 1}
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className={clsx('text-sm font-semibold', hecho[p.id] && 'text-tinta-suave line-through')}>{p.titulo}</span>
                  {actual && (
                    <>
                      <span className="text-xs text-tinta-suave">{p.como}</span>
                      <button onClick={() => { location.hash = `#${p.ir}`; }} className="self-start rounded-md bg-acento px-2.5 py-1 text-xs font-semibold text-white">{p.boton} →</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {!siguiente && <p className="rounded-lg bg-desocupada/10 p-2 text-sm text-desocupada">¡Listo! Recorriste el día completo del hotel: de la reserva al cierre de caja.</p>}
          <div className="flex items-center justify-between gap-2 border-t border-borde px-2 pt-2 text-[11px] text-tinta-suave">
            <span>Los cambios quedan solo en este navegador.</span>
            <button onClick={reiniciar} className="font-semibold text-acento hover:underline">Reiniciar demo</button>
          </div>
        </div>
      )}
    </div>
  );
}
