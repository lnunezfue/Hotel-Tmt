/** Reglas del canal de venta (RF-RES-07). La base solo garantiza el rango de la comisión; el resto se valida aquí. */
export class ReglaCanalError extends Error {}

export const NOMBRE_CANAL_MIN = 2;
export const NOMBRE_CANAL_MAX = 60;

export function normalizarNombreCanal(nombre: string): string {
  const limpio = nombre.trim();
  if (limpio.length < NOMBRE_CANAL_MIN || limpio.length > NOMBRE_CANAL_MAX) {
    throw new ReglaCanalError(`El nombre del canal debe tener entre ${NOMBRE_CANAL_MIN} y ${NOMBRE_CANAL_MAX} caracteres`);
  }
  return limpio;
}

/** Porcentaje que el canal cobra sobre la venta: de 0 a 100, con dos decimales como máximo (DECIMAL(5,2)). */
export function validarComision(valor: number): void {
  if (!Number.isFinite(valor) || valor < 0 || valor > 100) throw new ReglaCanalError('La comisión debe estar entre 0 y 100 %');
  if (Math.abs(Math.round(valor * 100) - valor * 100) > 1e-9) throw new ReglaCanalError('La comisión admite como máximo dos decimales');
}
