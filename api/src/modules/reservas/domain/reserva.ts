/**
 * Reglas de la reserva (spec S-06 §5). Lógica pura: fechas, estados, capacidad y documentos.
 * Las horas de la base son UTC; Lima es UTC−5 todo el año.
 */

export class ReglaReservaError extends Error {}

export const ZONA_LIMA_HORAS = -5;
/** Hora de ingreso y de salida estándar del hotel para reservas por noche. */
export const HORA_INGRESO = 14;
export const HORA_SALIDA = 12;
export const MAX_NOCHES = 60;

export type EstadoReserva = 'PENDIENTE' | 'CONFIRMADA' | 'EN_CURSO' | 'FINALIZADA' | 'CANCELADA' | 'NO_SHOW';
export type AccionReserva = 'confirmar' | 'cancelar' | 'no_show' | 'checkin';

/** Estados que ocupan la habitación en el calendario (coinciden con el trigger trg_rh_bi_solape). */
export const ESTADOS_QUE_OCUPAN: EstadoReserva[] = ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'];

/** "2026-11-23" + hora de Lima → instante UTC. */
export function instanteLima(fecha: string, hora: number, minuto = 0): Date {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d, hora - ZONA_LIMA_HORAS, minuto));
}

/** Fecha de Lima (AAAA-MM-DD) de un instante. */
export function fechaLima(instante: Date): string {
  return new Date(instante.getTime() + ZONA_LIMA_HORAS * 3_600_000).toISOString().slice(0, 10);
}

/** Reserva por noches: entra a las 14:00 del día de llegada y sale a las 12:00 tras la última noche. */
export function rangoPorNoches(llegada: string, noches: number): { entrada: Date; salida: Date } {
  if (!Number.isInteger(noches) || noches < 1 || noches > MAX_NOCHES) throw new ReglaReservaError(`Las noches deben ser de 1 a ${MAX_NOCHES}`);
  const entrada = instanteLima(llegada, HORA_INGRESO);
  const salida = instanteLima(llegada, HORA_SALIDA);
  salida.setUTCDate(salida.getUTCDate() + noches);
  return { entrada, salida };
}

/** Reserva por horas (turnos de 3, 6 o 12 h): desde la hora indicada. */
export function rangoPorHoras(llegada: string, hora: string, horasTurno: number, turnos: number): { entrada: Date; salida: Date } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora);
  if (!m) throw new ReglaReservaError('Hora de llegada no válida; usa HH:MM');
  if (!Number.isInteger(turnos) || turnos < 1 || turnos > 8) throw new ReglaReservaError('Los turnos deben ser de 1 a 8');
  const entrada = instanteLima(llegada, Number(m[1]), Number(m[2]));
  return { entrada, salida: new Date(entrada.getTime() + horasTurno * turnos * 3_600_000) };
}

export function seCruzan(a: { entrada: Date; salida: Date }, b: { entrada: Date; salida: Date }): boolean {
  return a.entrada < b.salida && b.entrada < a.salida;
}

/** Qué estado deja cada acción; lanza si no corresponde. `ahora` decide check-in y no-show. */
export function aplicarAccion(estado: EstadoReserva, accion: AccionReserva, rango: { entrada: Date; salida: Date }, ahora: Date): EstadoReserva {
  const abierta = estado === 'PENDIENTE' || estado === 'CONFIRMADA';
  switch (accion) {
    case 'confirmar':
      if (estado !== 'PENDIENTE') throw new ReglaReservaError(`Solo se confirma una reserva pendiente (está ${legible(estado)})`);
      return 'CONFIRMADA';
    case 'cancelar':
      if (!abierta) throw new ReglaReservaError(`No se puede cancelar una reserva ${legible(estado)}`);
      return 'CANCELADA';
    case 'no_show':
      if (!abierta) throw new ReglaReservaError(`No se puede marcar como no presentada una reserva ${legible(estado)}`);
      if (fechaLima(ahora) < fechaLima(rango.entrada)) throw new ReglaReservaError('Solo se marca «no se presentó» desde el día de llegada');
      return 'NO_SHOW';
    case 'checkin':
      if (!abierta) throw new ReglaReservaError(`No se puede hacer check-in de una reserva ${legible(estado)}`);
      if (fechaLima(ahora) < fechaLima(rango.entrada)) throw new ReglaReservaError(`El check-in de esta reserva es desde el ${fechaLima(rango.entrada)}`);
      if (ahora >= rango.salida) throw new ReglaReservaError('La reserva ya venció; márcala como no presentada');
      return 'EN_CURSO';
  }
}

export function validarHuespedes(adultos: number, ninos: number, capacidad: { adultos: number; ninos: number }): void {
  if (!Number.isInteger(adultos) || adultos < 1) throw new ReglaReservaError('Debe haber al menos un adulto');
  if (!Number.isInteger(ninos) || ninos < 0) throw new ReglaReservaError('Cantidad de niños no válida');
  if (adultos > capacidad.adultos) throw new ReglaReservaError(`La habitación admite como máximo ${capacidad.adultos} adultos`);
  if (adultos + ninos > capacidad.adultos + capacidad.ninos) {
    throw new ReglaReservaError(`La habitación admite como máximo ${capacidad.adultos + capacidad.ninos} personas`);
  }
}

export function codigoReserva(correlativo: number): string {
  return `R-${String(correlativo).padStart(6, '0')}`;
}

/** Documento del huésped según su tipo (DNI, RUC, CE, pasaporte). Devuelve el número normalizado. */
export function validarDocumento(abreviatura: string, numero: string): string {
  const n = numero.trim().toUpperCase();
  switch (abreviatura.toUpperCase()) {
    case 'DNI':
      if (!/^\d{8}$/.test(n)) throw new ReglaReservaError('El DNI tiene 8 dígitos');
      return n;
    case 'RUC':
      if (!/^(10|15|17|20)\d{9}$/.test(n) || !rucValido(n)) throw new ReglaReservaError('RUC no válido');
      return n;
    default:
      if (!/^[A-Z0-9]{4,15}$/.test(n)) throw new ReglaReservaError('El documento admite de 4 a 15 letras o números');
      return n;
  }
}

/** Dígito verificador del RUC (módulo 11 de SUNAT). */
export function rucValido(ruc: string): boolean {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(ruc[i]), 0);
  const dv = (11 - (suma % 11)) % 10;
  return dv === Number(ruc[10]);
}

function legible(e: EstadoReserva): string {
  return { PENDIENTE: 'pendiente', CONFIRMADA: 'confirmada', EN_CURSO: 'en curso', FINALIZADA: 'finalizada', CANCELADA: 'cancelada', NO_SHOW: 'no presentada' }[e];
}
