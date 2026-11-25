/** Reglas del turno de alquiler (RF-RES-08). La base garantiza 1–24 y la unicidad; los mensajes salen de aquí. */
export class ReglaTurnoError extends Error {}

export const NOMBRE_TURNO_MIN = 2;
export const NOMBRE_TURNO_MAX = 30;

export function normalizarNombreTurno(nombre: string): string {
  const limpio = nombre.trim();
  if (limpio.length < NOMBRE_TURNO_MIN || limpio.length > NOMBRE_TURNO_MAX) {
    throw new ReglaTurnoError(`El nombre del turno debe tener entre ${NOMBRE_TURNO_MIN} y ${NOMBRE_TURNO_MAX} caracteres`);
  }
  return limpio;
}

export function validarDuracionTurno(horas: number): void {
  if (!Number.isInteger(horas) || horas < 1 || horas > 24) throw new ReglaTurnoError('La duración debe ser un número entero de horas, de 1 a 24');
}
