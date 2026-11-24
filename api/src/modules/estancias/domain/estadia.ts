/**
 * Reglas de la estadía en curso que complementan el cobro (spec 2026-11-25): salida tardía, extensión, traslado y
 * datos del libro de huéspedes. Lógica pura.
 */
export class ReglaEstadiaError extends Error {}

/** Minutos de gracia tras la salida prevista antes de sumar otro turno (la misma que la alerta del tablero). */
export const TOLERANCIA_SALIDA_MIN = 30;
export const EXTENSION_MAX = 30;

export const MOTIVOS_VIAJE = ['Turismo', 'Negocios', 'Trabajo', 'Salud', 'Estudios', 'Visita familiar', 'Otro'] as const;
export type MotivoViaje = (typeof MOTIVOS_VIAJE)[number];

/**
 * Turnos que se suman por salir tarde: ninguno hasta la tolerancia; después, uno por cada turno (o fracción)
 * que pasó desde la salida prevista. Salir antes no devuelve turnos (RF-RES-12: según turnos consumidos).
 */
export function turnosAdicionales(salidaPrevista: Date, ahora: Date, horasTurno: number, toleranciaMin = TOLERANCIA_SALIDA_MIN): number {
  const exceso = ahora.getTime() - salidaPrevista.getTime() - toleranciaMin * 60_000;
  if (exceso <= 0) return 0;
  return Math.ceil((exceso + toleranciaMin * 60_000) / (horasTurno * 3_600_000));
}

export function validarExtension(turnos: number): void {
  if (!Number.isInteger(turnos) || turnos < 1 || turnos > EXTENSION_MAX) throw new ReglaEstadiaError(`La extensión debe ser de 1 a ${EXTENSION_MAX} turnos`);
}

export function salidaExtendida(salidaPrevista: Date, horasTurno: number, turnos: number): Date {
  return new Date(salidaPrevista.getTime() + horasTurno * turnos * 3_600_000);
}

export function normalizarMotivoTraslado(motivo: string): string {
  const t = motivo.trim().replace(/\s+/g, ' ');
  if (t.length < 5 || t.length > 200) throw new ReglaEstadiaError('El motivo del traslado debe tener entre 5 y 200 caracteres');
  return t;
}

/** Destino y motivo del viaje del libro de huéspedes (RF-RES-11). Ambos opcionales; el motivo, de la lista. */
export function normalizarLibro(d: { destino?: string | null; motivoViaje?: string | null }): { destino: string | null; motivoViaje: MotivoViaje | null } {
  const destino = d.destino?.trim().replace(/\s+/g, ' ') || null;
  if (destino && destino.length > 100) throw new ReglaEstadiaError('El destino admite hasta 100 caracteres');
  const motivo = d.motivoViaje?.trim() || null;
  if (motivo && !(MOTIVOS_VIAJE as readonly string[]).includes(motivo)) throw new ReglaEstadiaError(`El motivo del viaje debe ser uno de: ${MOTIVOS_VIAJE.join(', ')}`);
  return { destino, motivoViaje: motivo as MotivoViaje | null };
}

/** Rangos semiabiertos [inicio, fin): se cruzan si cada uno empieza antes de que termine el otro. */
export function seCruzan(a: { inicio: Date; fin: Date }, b: { inicio: Date; fin: Date }): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}
