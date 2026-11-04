/**
 * Máquina de estados de la habitación (RF-RES-04). Lógica pura: no conoce la base de datos ni HTTP.
 */
export const ESTADOS = ['DESOCUPADA', 'RESERVADA', 'CONFIRMADA', 'OCUPADA', 'LIMPIEZA', 'MANTENIMIENTO'] as const;
export type EstadoHabitacion = (typeof ESTADOS)[number];

const TRANSICIONES: Record<EstadoHabitacion, EstadoHabitacion[]> = {
  DESOCUPADA: ['RESERVADA', 'OCUPADA', 'MANTENIMIENTO', 'LIMPIEZA'],
  RESERVADA: ['CONFIRMADA', 'OCUPADA', 'DESOCUPADA'],
  CONFIRMADA: ['OCUPADA', 'DESOCUPADA'],
  OCUPADA: ['LIMPIEZA'],
  LIMPIEZA: ['DESOCUPADA', 'MANTENIMIENTO'],
  MANTENIMIENTO: ['DESOCUPADA'],
};

export function esEstado(valor: string): valor is EstadoHabitacion {
  return (ESTADOS as readonly string[]).includes(valor);
}

export function transicionesPermitidas(desde: EstadoHabitacion): EstadoHabitacion[] {
  return TRANSICIONES[desde];
}

export class TransicionInvalidaError extends Error {
  constructor(public readonly desde: EstadoHabitacion, public readonly hacia: EstadoHabitacion) {
    super(`No se puede pasar de ${desde} a ${hacia}. Desde ${desde} se permite: ${TRANSICIONES[desde].join(', ')}`);
  }
}

export function validarTransicion(desde: EstadoHabitacion, hacia: EstadoHabitacion): void {
  if (desde === hacia || !TRANSICIONES[desde].includes(hacia)) throw new TransicionInvalidaError(desde, hacia);
}

/** Salida prevista según el turno contratado (3, 6, 12 o 24 h) y la cantidad de turnos (RF-RES-08, RF-RES-12). */
export function calcularSalidaPrevista(checkin: Date, horasTurno: number, cantidadTurnos: number): Date {
  if (![3, 6, 12, 24].includes(horasTurno)) throw new Error(`Turno no válido: ${horasTurno} h`);
  if (!Number.isInteger(cantidadTurnos) || cantidadTurnos < 1) throw new Error('La cantidad de turnos debe ser un entero mayor a 0');
  return new Date(checkin.getTime() + horasTurno * cantidadTurnos * 3_600_000);
}

/** Alerta del tablero (RF-RES-15): VENCIDA si pasó la salida, POR_VENCER si falta menos de `margenMin`. */
export function alertaSalida(salidaPrevista: Date, ahora: Date, margenMin = 30): 'VENCIDA' | 'POR_VENCER' | null {
  const resta = salidaPrevista.getTime() - ahora.getTime();
  if (resta < 0) return 'VENCIDA';
  if (resta <= margenMin * 60_000) return 'POR_VENCER';
  return null;
}
