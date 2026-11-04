import { useMemo } from 'react';
import clsx from 'clsx';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

/**
 * MAQUETA del módulo de reservas (sprint S-06). Los datos son de ejemplo y no se guardan.
 * Sirve para validar con recepción el calendario y el formulario antes de construirlos.
 */
const HABITACIONES = [
  { numero: '101', tipo: 'Simple' }, { numero: '102', tipo: 'Doble' }, { numero: '103', tipo: 'Matrimonial' },
  { numero: '104', tipo: 'Simple' }, { numero: '201', tipo: 'Doble' }, { numero: '202', tipo: 'Matrimonial' },
  { numero: '203', tipo: 'Simple' }, { numero: '301', tipo: 'Doble' },
];

type Canal = 'Recepción' | 'Booking' | 'Teléfono';
const RESERVAS: Array<{ hab: string; desde: number; noches: number; titular: string; canal: Canal; estado: 'CONFIRMADA' | 'PENDIENTE' | 'EN CURSO' }> = [
  { hab: '101', desde: -1, noches: 2, titular: 'C. Mendoza', canal: 'Recepción', estado: 'EN CURSO' },
  { hab: '102', desde: 1, noches: 3, titular: 'V. Soto', canal: 'Booking', estado: 'CONFIRMADA' },
  { hab: '103', desde: 0, noches: 1, titular: 'L. Gutiérrez', canal: 'Teléfono', estado: 'PENDIENTE' },
  { hab: '201', desde: 2, noches: 4, titular: 'D. Arce', canal: 'Booking', estado: 'CONFIRMADA' },
  { hab: '203', desde: 0, noches: 2, titular: 'M. Quispe', canal: 'Recepción', estado: 'CONFIRMADA' },
  { hab: '301', desde: 4, noches: 2, titular: 'Empresa Minera Sur', canal: 'Teléfono', estado: 'PENDIENTE' },
  { hab: '104', desde: 3, noches: 1, titular: 'J. Torres', canal: 'Booking', estado: 'PENDIENTE' },
];
const COLOR_CANAL: Record<Canal, string> = {
  Recepción: 'bg-desocupada/15 border-desocupada/50 text-desocupada',
  Booking: 'bg-reservada/15 border-reservada/50 text-reservada',
  Teléfono: 'bg-acento/15 border-acento/50 text-acento',
};
const DIAS = 7;

export function ReservasPage() {
  const dias = useMemo(() => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return Array.from({ length: DIAS }, (_, i) => new Date(hoy.getTime() + i * 86_400_000));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs text-tinta-suave">Hotel / Reservas</div>
          <h1 className="text-2xl font-bold">Reservas</h1>
        </div>
        <span className="rounded-lg bg-acento-suave px-3 py-1.5 text-sm font-medium text-acento">Maqueta con datos de ejemplo · se construye en el sprint S-06</span>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card className="min-w-0 overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[120px_repeat(7,1fr)] border-b border-borde bg-fondo text-xs font-semibold tracking-wide text-tinta-suave uppercase">
              <div className="px-3 py-2">Habitación</div>
              {dias.map((d, i) => (
                <div key={i} className={clsx('px-2 py-2 text-center', i === 0 && 'text-acento')}>
                  {d.toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit' })}
                  {i === 0 && ' · hoy'}
                </div>
              ))}
            </div>
            {HABITACIONES.map((h) => (
              <div key={h.numero} className="relative grid h-14 grid-cols-[120px_repeat(7,1fr)] border-b border-borde last:border-0">
                <div className="flex flex-col justify-center px-3">
                  <span className="font-semibold tabular-nums">{h.numero}</span>
                  <span className="text-xs text-tinta-suave">{h.tipo}</span>
                </div>
                {dias.map((_, i) => <div key={i} className={clsx('border-l border-borde', i === 0 && 'bg-acento/5')} />)}
                {RESERVAS.filter((r) => r.hab === h.numero).map((r) => {
                  const ini = Math.max(r.desde, 0);
                  const fin = Math.min(r.desde + r.noches, DIAS);
                  if (fin <= 0) return null;
                  return (
                    <div
                      key={r.titular}
                      className={clsx('absolute top-2 bottom-2 flex flex-col justify-center overflow-hidden rounded-md border px-2 text-xs', COLOR_CANAL[r.canal])}
                      style={{ left: `calc(120px + (100% - 120px) * ${ini / DIAS} + 2px)`, width: `calc((100% - 120px) * ${(fin - ini) / DIAS} - 4px)` }}
                      title={`${r.titular} · ${r.canal} · ${r.estado}`}
                    >
                      <span className="truncate font-semibold">{r.titular}</span>
                      <span className="truncate opacity-80">{r.canal} · {r.estado.toLowerCase()}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-4 border-t border-borde px-3 py-2 text-xs text-tinta-suave">
            {(Object.keys(COLOR_CANAL) as Canal[]).map((c) => (
              <span key={c} className="flex items-center gap-1.5"><span className={clsx('h-3 w-5 rounded border', COLOR_CANAL[c])} /> {c}</span>
            ))}
            <span className="ml-auto">El sistema impide reservar una habitación en fechas que se cruzan (RF-RES-18).</span>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <h2 className="text-lg font-semibold">Nueva reserva</h2>
          <fieldset disabled className="flex flex-col gap-3 text-sm">
            <label className="flex flex-col gap-1">Huésped titular (DNI, CE o pasaporte)
              <input className="h-9 rounded-lg border border-borde bg-fondo px-3" defaultValue="DNI 45678912 · Carlos Mendoza Ríos" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">Entrada<input className="h-9 rounded-lg border border-borde bg-fondo px-3" defaultValue={dias[1].toLocaleDateString('es-PE')} /></label>
              <label className="flex flex-col gap-1">Turno
                <select className="h-9 rounded-lg border border-borde bg-fondo px-2"><option>24 horas</option><option>12 horas</option><option>6 horas</option><option>3 horas</option></select>
              </label>
              <label className="flex flex-col gap-1">Canal
                <select className="h-9 rounded-lg border border-borde bg-fondo px-2"><option>Recepción</option><option>Booking</option><option>Teléfono</option></select>
              </label>
              <label className="flex flex-col gap-1">Noches o turnos<input className="h-9 rounded-lg border border-borde bg-fondo px-3" defaultValue="2" /></label>
            </div>
            <label className="flex flex-col gap-1">Habitación disponible
              <select className="h-9 rounded-lg border border-borde bg-fondo px-2"><option>104 · Simple</option></select>
            </label>
          </fieldset>
          <div className="rounded-lg bg-fondo p-3 text-sm">
            <div className="flex justify-between gap-3"><span>Tarifa vigente (Recepción · 24 h)</span><b className="whitespace-nowrap tabular-nums">S/ 70.00</b></div>
            <div className="flex justify-between"><span>× 2 noches</span><b className="whitespace-nowrap tabular-nums">S/ 140.00</b></div>
            <p className="mt-1 text-xs text-tinta-suave">El precio sale de la tabla de tarifas por canal, tipo de habitación y turno.</p>
          </div>
          <Button variante="primario" disabled>Registrar reserva</Button>
        </Card>
      </div>
    </div>
  );
}
