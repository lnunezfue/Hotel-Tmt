/**
 * Vigencia de tarifas (spec S-04 §5.2, D6–D7). Las fechas son `YYYY-MM-DD` en hora de Lima, igual que la
 * columna DATE: comparar cadenas de ese formato equivale a comparar fechas.
 */

export const PRECIO_MAXIMO = 99_999;

export class ReglaTarifaError extends Error {}

export interface Vigencia {
  id: number;
  desde: string;
  hasta: string | null;
  activo?: boolean;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function esFecha(valor: string): boolean {
  if (!FECHA.test(valor)) return false;
  const d = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

/** Fecha de hoy en Lima (UTC−5, sin horario de verano). */
export function hoyLima(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Columna DATE ↔ cadena: Prisma devuelve la fecha a medianoche UTC. */
export const fechaDeDb = (d: Date): string => d.toISOString().slice(0, 10);
export const fechaADb = (f: string): Date => new Date(`${f}T00:00:00Z`);

export function cubre(t: Vigencia, fecha: string): boolean {
  return t.activo !== false && t.desde <= fecha && (t.hasta === null || t.hasta >= fecha);
}

/** La tarifa que rige en la fecha: entre las que la cubren, la que empezó más tarde. */
export function tarifaVigente<T extends Vigencia>(tarifas: T[], fecha: string): T | null {
  let elegida: T | null = null;
  for (const t of tarifas) if (cubre(t, fecha) && (!elegida || t.desde > elegida.desde)) elegida = t;
  return elegida;
}

/** La próxima tarifa programada después de la fecha (para mostrar "desde el 15/12: S/ 90"). */
export function tarifaProgramada<T extends Vigencia>(tarifas: T[], fecha: string): T | null {
  let elegida: T | null = null;
  for (const t of tarifas) if (t.activo !== false && t.desde > fecha && (!elegida || t.desde < elegida.desde)) elegida = t;
  return elegida;
}

export function validarPrecio(precio: number): void {
  if (!Number.isFinite(precio) || precio <= 0) throw new ReglaTarifaError('El precio debe ser mayor que cero');
  if (precio > PRECIO_MAXIMO) throw new ReglaTarifaError(`El precio no puede superar S/ ${PRECIO_MAXIMO.toLocaleString('es-PE')}`);
  if (Math.round(precio * 100) !== precio * 100) throw new ReglaTarifaError('El precio admite como máximo dos decimales');
}

/**
 * Qué hacer para que una tarifa nueva rija desde `desde` con la misma clave (sucursal, tipo, canal, turno):
 * las vigentes que cubren esa fecha se cierran el día anterior (D6). Lanza si la fecha es pasada, si ya existe
 * una tarifa desde ese mismo día o si hay otra programada después (habría dos cambios superpuestos).
 */
export function planificarTarifa(existentes: Vigencia[], desde: string, hoy: string): { cerrar: Array<{ id: number; hasta: string }> } {
  if (!esFecha(desde)) throw new ReglaTarifaError('Fecha de inicio no válida');
  if (desde < hoy) throw new ReglaTarifaError('La tarifa no puede regir desde una fecha pasada');
  const activas = existentes.filter((t) => t.activo !== false);
  if (activas.some((t) => t.desde === desde)) throw new ReglaTarifaError(`Ya hay una tarifa que rige desde el ${desde}`);
  const posterior = tarifaProgramada(activas, desde);
  if (posterior) throw new ReglaTarifaError(`Ya hay un cambio programado desde el ${posterior.desde}; prográmalo después de esa fecha`);
  const hasta = sumarDias(desde, -1);
  return { cerrar: activas.filter((t) => cubre(t, desde)).map((t) => ({ id: t.id, hasta })) };
}
