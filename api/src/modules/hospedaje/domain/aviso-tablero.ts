/**
 * Aviso de que el tablero de una sucursal cambió (S-05 D2). No lleva datos: quien lo recibe vuelve a pedir
 * el tablero. Viaja por Redis en el canal de la sucursal, de modo que llega a todas las réplicas de la API.
 */
export const MOTIVOS_AVISO = ['estado', 'habitacion', 'piso', 'tipo'] as const;
export type MotivoAviso = (typeof MOTIVOS_AVISO)[number];

export interface AvisoTablero {
  sucursalId: number;
  motivo: MotivoAviso;
}

const PREFIJO = 'tablero:sucursal:';
export const PATRON_CANALES = `${PREFIJO}*`;

export function canalDe(sucursalId: number): string {
  return `${PREFIJO}${sucursalId}`;
}

export function mensajeDe(aviso: AvisoTablero): string {
  return JSON.stringify({ motivo: aviso.motivo });
}

const esMotivo = (v: unknown): v is MotivoAviso => typeof v === 'string' && (MOTIVOS_AVISO as readonly string[]).includes(v);

/** Interpreta lo recibido de Redis. Cualquier cosa que no sea un aviso bien formado se descarta (null); nunca lanza. */
export function leerAviso(canal: string, mensaje: string): AvisoTablero | null {
  if (!canal.startsWith(PREFIJO)) return null;
  const id = canal.slice(PREFIJO.length);
  if (!/^[1-9]\d{0,9}$/.test(id)) return null;
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(mensaje);
  } catch {
    return null;
  }
  if (typeof cuerpo !== 'object' || cuerpo === null) return null;
  const motivo = (cuerpo as { motivo?: unknown }).motivo;
  return esMotivo(motivo) ? { sucursalId: Number(id), motivo } : null;
}
