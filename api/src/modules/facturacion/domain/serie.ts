/**
 * Series de comprobantes (RF-FAC-01, RF-FAC-02; spec S-07 D1–D4). Lógica pura.
 */
export class ReglaSerieError extends Error {}

export const TIPOS_SERIE = ['FACTURA', 'BOLETA', 'INTERNO', 'NOTA_CREDITO', 'NOTA_DEBITO'] as const;
export type TipoSerie = (typeof TIPOS_SERIE)[number];
/** Tipos que se eligen al cobrar: siempre debe quedar al menos una serie activa de cada uno. */
export const TIPOS_VENTA: TipoSerie[] = ['FACTURA', 'BOLETA', 'INTERNO'];

const PATRON: Record<TipoSerie, { patron: RegExp; ayuda: string }> = {
  FACTURA: { patron: /^F[A-Z0-9]{3}$/, ayuda: 'F y 3 letras o dígitos (ej. F001)' },
  BOLETA: { patron: /^B[A-Z0-9]{3}$/, ayuda: 'B y 3 letras o dígitos (ej. B001)' },
  NOTA_CREDITO: { patron: /^[FB][A-Z0-9]{3}$/, ayuda: 'F (corrige facturas) o B (corrige boletas) y 3 letras o dígitos (ej. FC01)' },
  NOTA_DEBITO: { patron: /^[FB][A-Z0-9]{3}$/, ayuda: 'F (corrige facturas) o B (corrige boletas) y 3 letras o dígitos (ej. FD01)' },
  INTERNO: { patron: /^I[A-Z0-9]{3}$/, ayuda: 'I y 3 letras o dígitos (ej. I001)' },
};

export function esTipoSerie(v: string): v is TipoSerie {
  return (TIPOS_SERIE as readonly string[]).includes(v);
}

/** Serie en mayúsculas; lanza si no tiene el prefijo y largo que exige SUNAT para el tipo. */
export function normalizarSerie(tipo: TipoSerie, serie: string): string {
  const s = serie.trim().toUpperCase();
  if (!PATRON[tipo].patron.test(s)) throw new ReglaSerieError(`La serie de ${legible(tipo)} debe ser ${PATRON[tipo].ayuda}`);
  return s;
}

export function validarCorrelativoInicial(n: number): void {
  if (!Number.isInteger(n) || n < 0 || n > 99_999_999) throw new ReglaSerieError('El número inicial debe ser un entero de 0 a 99 999 999');
}

export interface SerieCandidata {
  id: number;
  serie: string;
  usuarios: number[];
}

/**
 * La serie con la que emite un usuario (D4): una propia del tipo; si no tiene, una libre (sin usuarios asignados).
 * `pedida` elige entre las que puede usar. Lanza si no hay ninguna.
 */
export function elegirSerie(candidatas: SerieCandidata[], usuarioId: number, tipo: TipoSerie, pedida?: number): SerieCandidata {
  const propias = candidatas.filter((s) => s.usuarios.includes(usuarioId));
  const usables = propias.length ? propias : candidatas.filter((s) => s.usuarios.length === 0);
  if (pedida !== undefined) {
    const s = usables.find((x) => x.id === pedida);
    if (!s) throw new ReglaSerieError(`No puedes emitir ${legible(tipo)} con esa serie`);
    return s;
  }
  if (!usables.length) {
    throw new ReglaSerieError(`No tienes una serie de ${legible(tipo)} en esta sucursal: pide que te asignen una en «Series de comprobantes»`);
  }
  return [...usables].sort((a, b) => a.serie.localeCompare(b.serie))[0];
}

export function legible(tipo: TipoSerie): string {
  return { FACTURA: 'factura', BOLETA: 'boleta', INTERNO: 'nota interna', NOTA_CREDITO: 'nota de crédito', NOTA_DEBITO: 'nota de débito' }[tipo];
}
