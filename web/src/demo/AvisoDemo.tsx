import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import type { PasoRecorrido } from './servidor';
import { useSesion } from '../features/auth/sesion';

/** El proceso de un día en el hotel, en el orden en que ocurre. */
const PASOS: Array<{ id: PasoRecorrido; titulo: string; como: string; ir: string; boton: string }> = [
  { id: 'caja', titulo: 'Abrir la caja', como: 'Al empezar el turno: «Abrir caja» con el sencillo del cajón. Sin caja abierta no se cobra.', ir: '/caja', boton: 'Ir a Caja' },
  { id: 'checkin', titulo: 'Recibir a una pareja y cobrar', como: 'En el plano o el tablero, abre una habitación libre → «Check-in directo». Propone 4 horas y muestra a qué hora sale; cobra por adelantado en efectivo (calcula el vuelto) o con Culqi.', ir: '/plano', boton: 'Ir al Plano' },
  { id: 'extension', titulo: 'Se quedan más tiempo', como: 'Abre la 102 (entró hace hora y media) → «Ver estadía» → «Extender estadía» 1 turno y luego «Cobrar» la diferencia. Si la extensión pasa la hora máxima de su franja (18:00 si entraron de mañana, 6:00 si de noche), el sistema no la deja: pruébalo con la que acabas de registrar.', ir: '/', boton: 'Ir al Tablero' },
  { id: 'checkout', titulo: 'Salida sin cobrar', como: 'Como ya pagaron, «Check-out · la cuenta está pagada» solo libera la habitación: no emite otro comprobante.', ir: '/', boton: 'Ir al Tablero' },
  { id: 'limpieza', titulo: 'Limpieza de 30 minutos', como: 'La habitación queda «En limpieza» y el tablero cuenta los minutos (la 103 ya pasó los 30). Al terminar: «Marcar disponible».', ir: '/', boton: 'Ir al Tablero' },
  { id: 'reserva', titulo: 'Reserva que no llegó', como: 'Las reservas no piden adelanto y no todas se usan. En «Reservas», abre la de hoy de la 202 y márcala «No se presentó»: la habitación vuelve a venderse.', ir: '/reservas', boton: 'Ir a Reservas' },
  { id: 'cierre', titulo: 'Cerrar la caja', como: 'Al final del turno: cuenta el efectivo; el sistema separa lo cobrado con Culqi y dice si el efectivo cuadra.', ir: '/caja', boton: 'Ir a Caja' },
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
