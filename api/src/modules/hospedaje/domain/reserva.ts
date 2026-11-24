/**
 * Reglas de la reserva (RF-RES-06, RF-RES-16, RF-RES-18; spec S-06). Lógica pura.
 */
export class ReglaReservaError extends Error {}
/** La reserva no está en un estado que permita la acción (→ 409). */
export class EstadoReservaError extends ReglaReservaError {}

export const ESTADOS_RESERVA = ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO', 'FINALIZADA', 'CANCELADA', 'NO_SHOW'] as const;
export type EstadoReserva = (typeof ESTADOS_RESERVA)[number];

/** Estados en que la reserva todavía ocupa sus habitaciones. */
export const RESERVA_VIGENTE: EstadoReserva[] = ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'];
/** Estados desde los que aún se puede anular, marcar no-show o confirmar: nadie ha ingresado. */
const POR_LLEGAR: EstadoReserva[] = ['PENDIENTE', 'CONFIRMADA'];

export const TURNOS_MAX = 60;
export const PERSONAS_MAX = 50;

export function validarConfirmar(estado: EstadoReserva): void {
  if (estado !== 'PENDIENTE') throw new EstadoReservaError(`Solo se confirma una reserva pendiente; esta está ${texto(estado)}`);
}

export function validarAnular(estado: EstadoReserva): void {
  if (!POR_LLEGAR.includes(estado)) throw new EstadoReservaError(`No se anula una reserva ${texto(estado)}`);
}

/** No-show: solo cuando ya pasó la hora de entrada y nadie llegó. */
export function validarNoShow(estado: EstadoReserva, entrada: Date, ahora: Date): void {
  if (!POR_LLEGAR.includes(estado)) throw new EstadoReservaError(`No se marca como no presentada una reserva ${texto(estado)}`);
  if (ahora < entrada) throw new EstadoReservaError('La hora de entrada aún no llega; si el cliente avisa que no vendrá, anula la reserva');
}

export function validarCheckinDeReserva(estado: EstadoReserva): void {
  if (!RESERVA_VIGENTE.includes(estado)) throw new EstadoReservaError(`No se hace el check-in de una reserva ${texto(estado)}`);
}

export function normalizarMotivo(motivo: string): string {
  const t = motivo.trim().replace(/\s+/g, ' ');
  if (t.length < 5 || t.length > 250) throw new ReglaReservaError('El motivo debe tener entre 5 y 250 caracteres');
  return t;
}

export function validarCantidades(d: { cantidadTurnos: number; adultos: number; ninos: number }): void {
  if (!Number.isInteger(d.cantidadTurnos) || d.cantidadTurnos < 1 || d.cantidadTurnos > TURNOS_MAX) {
    throw new ReglaReservaError(`La cantidad de turnos debe ser un entero de 1 a ${TURNOS_MAX}`);
  }
  if (!Number.isInteger(d.adultos) || d.adultos < 1 || d.adultos > PERSONAS_MAX) throw new ReglaReservaError(`Los adultos deben ser de 1 a ${PERSONAS_MAX}`);
  if (!Number.isInteger(d.ninos) || d.ninos < 0 || d.ninos > PERSONAS_MAX) throw new ReglaReservaError(`Los niños deben ser de 0 a ${PERSONAS_MAX}`);
}

/** Dos rangos semiabiertos [inicio, fin) se cruzan si cada uno empieza antes de que termine el otro. */
export function seCruzan(a: { inicio: Date; fin: Date }, b: { inicio: Date; fin: Date }): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

/** Siguiente código `R-AAAA-NNNNNN` de la sucursal, a partir del último del mismo año (o ninguno). */
export function siguienteCodigo(anio: number, ultimo: string | null): string {
  const prefijo = `R-${anio}-`;
  let n = 0;
  if (ultimo !== null) {
    if (!ultimo.startsWith(prefijo) || !/^\d{6}$/.test(ultimo.slice(prefijo.length))) throw new Error(`Código de reserva inesperado: ${ultimo}`);
    n = Number(ultimo.slice(prefijo.length));
  }
  return `${prefijo}${String(n + 1).padStart(6, '0')}`;
}

const TEXTO: Record<EstadoReserva, string> = {
  PENDIENTE: 'pendiente',
  CONFIRMADA: 'confirmada',
  EN_CURSO: 'en curso',
  FINALIZADA: 'finalizada',
  CANCELADA: 'anulada',
  NO_SHOW: 'marcada como no presentada',
};

function texto(e: EstadoReserva): string {
  return TEXTO[e];
}
