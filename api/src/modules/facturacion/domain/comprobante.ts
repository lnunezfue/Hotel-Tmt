import { ComprobanteAEmitir, TipoCpe } from './proveedor-facturacion.port';
import { normalizarSerie, ReglaSerieError } from './serie';

/**
 * Estructura del comprobante electrónico (spec S-07 D10): convierte un comprobante guardado en lo que recibe el
 * proveedor (`ComprobanteAEmitir`) y verifica que cuadre antes de enviarlo. Lógica pura; importes en céntimos.
 */
export class EstructuraComprobanteError extends Error {}

const CODIGO_SUNAT: Record<TipoCpe, string> = { FACTURA: '01', BOLETA: '03', NOTA_CREDITO: '07', NOTA_DEBITO: '08' };

export interface LineaGuardada {
  descripcion: string;
  cantidad: number;
  /** Valor unitario sin IGV, en soles (hasta 4 decimales). */
  valorUnitario: number;
  precioUnitario: number;
  valorVenta: number;
  igv: number;
  total: number;
  /** Catálogo 07 (10 = gravado, operación onerosa). */
  afectacionIgv: string;
}

export interface ComprobanteGuardado {
  rucEmisor: string;
  tipo: string;
  serie: string;
  numero: number;
  fechaEmision: string;
  moneda: 'PEN' | 'USD';
  cliente: { tipoDocumento: string; numeroDocumento: string; nombre: string; direccion?: string | null };
  lineas: LineaGuardada[];
  totales: { gravada: number; exonerada: number; inafecta: number; igv: number; descuentoBase: number; descuentoIgv: number; total: number };
}

const c = (soles: number) => Math.round(soles * 100);

export function armarComprobante(g: ComprobanteGuardado): ComprobanteAEmitir {
  if (!(g.tipo in CODIGO_SUNAT)) throw new EstructuraComprobanteError(`Un comprobante ${g.tipo} no se envía a SUNAT`);
  const tipo = g.tipo as TipoCpe;
  try {
    if (normalizarSerie(tipo, g.serie) !== g.serie) throw new EstructuraComprobanteError('La serie no está en mayúsculas');
  } catch (e) {
    if (e instanceof ReglaSerieError) throw new EstructuraComprobanteError(e.message);
    throw e;
  }
  if (!Number.isInteger(g.numero) || g.numero < 1 || g.numero > 99_999_999) throw new EstructuraComprobanteError('Número de comprobante fuera de rango');
  if (!g.lineas.length) throw new EstructuraComprobanteError('El comprobante no tiene líneas');
  if (tipo === 'FACTURA' && g.cliente.tipoDocumento !== '6') throw new EstructuraComprobanteError('La factura requiere un receptor con RUC');

  // Cuadre: cada línea (base + IGV = total) y los totales contra la suma de líneas menos el descuento global
  for (const [i, l] of g.lineas.entries()) {
    if (c(l.valorVenta) + c(l.igv) !== c(l.total)) throw new EstructuraComprobanteError(`La línea ${i + 1} no cuadra: base + IGV ≠ total`);
  }
  const suma = (k: 'valorVenta' | 'igv' | 'total') => g.lineas.reduce((s, l) => s + c(l[k]), 0);
  const t = g.totales;
  if (suma('valorVenta') - c(t.descuentoBase) !== c(t.gravada)) throw new EstructuraComprobanteError('La base gravada no cuadra con las líneas y el descuento');
  if (suma('igv') - c(t.descuentoIgv) !== c(t.igv)) throw new EstructuraComprobanteError('El IGV no cuadra con las líneas y el descuento');
  if (suma('total') - c(t.descuentoBase) - c(t.descuentoIgv) !== c(t.total)) throw new EstructuraComprobanteError('El total no cuadra con las líneas y el descuento');
  if (tipo === 'BOLETA' && c(t.total) > 70_000 && g.cliente.tipoDocumento === '0') {
    throw new EstructuraComprobanteError('Una boleta de más de S/ 700 exige el documento del comprador');
  }

  return {
    tipo,
    serie: g.serie,
    numero: g.numero,
    fechaEmision: g.fechaEmision,
    moneda: g.moneda,
    cliente: {
      tipoDocumento: g.cliente.tipoDocumento,
      numeroDocumento: g.cliente.numeroDocumento,
      nombre: g.cliente.nombre,
      ...(g.cliente.direccion ? { direccion: g.cliente.direccion } : {}),
    },
    items: g.lineas.map((l) => ({
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      valorUnitario: l.valorUnitario,
      precioUnitario: l.precioUnitario,
      igv: l.igv,
      total: l.total,
      afectacionIgv: l.afectacionIgv,
    })),
    // El descuento global va aparte de las líneas (no prorrateado), por su base imponible
    totales: { gravada: t.gravada, exonerada: t.exonerada, inafecta: t.inafecta, igv: t.igv, descuentoGlobal: t.descuentoBase, total: t.total },
    claveIdempotencia: `${g.rucEmisor}-${CODIGO_SUNAT[tipo]}-${g.serie}-${g.numero}`,
  };
}
