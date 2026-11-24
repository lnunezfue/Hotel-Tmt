/**
 * Cuenta y cobro del check-out (spec S-07 §4). Lógica pura con céntimos enteros para no arrastrar
 * errores de coma flotante. Los precios del hotel incluyen IGV (18 %).
 */

export class ReglaCobroError extends Error {}

export const TASA_IGV = 0.18;

/** Soles → céntimos enteros. */
export const aCentimos = (soles: number | string): number => Math.round(Number(soles) * 100);
export const aSoles = (centimos: number): string => (centimos / 100).toFixed(2);

export interface LineaCuenta {
  tipo: 'HOSPEDAJE' | 'CARGO';
  descripcion: string;
  cantidad: number;
  /** Precio con IGV, en soles. */
  precioUnitario: string;
  total: string;
  estanciaId?: string;
  cargoId?: string;
  productoId?: number | null;
}

/** Desglose de una línea con IGV incluido: valor de venta (base) + IGV = total. */
export function desglosarIgv(totalCentimos: number): { valorVenta: number; igv: number; total: number } {
  const valorVenta = Math.round(totalCentimos / (1 + TASA_IGV));
  return { valorVenta, igv: totalCentimos - valorVenta, total: totalCentimos };
}

/** Totales del comprobante: suma de bases y de IGV por línea (cuadra exactamente con el total). */
export function totalesComprobante(lineas: Array<{ total: string }>): { gravada: string; igv: string; total: string } {
  let gravada = 0;
  let igv = 0;
  let total = 0;
  for (const l of lineas) {
    const d = desglosarIgv(aCentimos(l.total));
    gravada += d.valorVenta;
    igv += d.igv;
    total += d.total;
  }
  return { gravada: aSoles(gravada), igv: aSoles(igv), total: aSoles(total) };
}

export interface Pago {
  metodo: string;
  esEfectivo: boolean;
  monto: number;
  referencia?: string | null;
}

/**
 * Reparte lo que entrega el huésped contra el saldo. Los pagos que no son en efectivo no pueden superar el saldo;
 * si sobra efectivo, es el vuelto y se registra solo lo cobrado. Lanza si falta dinero.
 */
export function repartirPagos(saldoCentimos: number, pagos: Pago[]): { registrados: Pago[]; vuelto: number } {
  if (pagos.some((p) => !(p.monto > 0))) throw new ReglaCobroError('Cada pago debe ser mayor que cero');
  const noEfectivo = pagos.filter((p) => !p.esEfectivo).reduce((s, p) => s + aCentimos(p.monto), 0);
  const efectivo = pagos.filter((p) => p.esEfectivo).reduce((s, p) => s + aCentimos(p.monto), 0);
  if (noEfectivo > saldoCentimos) throw new ReglaCobroError('Los pagos con tarjeta, Yape o transferencia superan el saldo; el vuelto solo se da en efectivo');
  const entregado = noEfectivo + efectivo;
  if (entregado < saldoCentimos) throw new ReglaCobroError(`Falta cobrar S/ ${aSoles(saldoCentimos - entregado)}`);
  const vuelto = entregado - saldoCentimos;
  let porDescontar = vuelto;
  const registrados = pagos
    .map((p) => {
      if (!p.esEfectivo || porDescontar === 0) return p;
      const c = aCentimos(p.monto);
      const quita = Math.min(c, porDescontar);
      porDescontar -= quita;
      return { ...p, monto: (c - quita) / 100 };
    })
    .filter((p) => p.monto > 0);
  return { registrados, vuelto };
}

export function comision(totalCentimos: number, porcentaje: number | string): number {
  return Math.round((totalCentimos * Number(porcentaje)) / 100);
}

const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function hasta999(n: number): string {
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r < 30) {
    if (r) partes.push(UNIDADES[r]);
  } else {
    const d = Math.floor(r / 10);
    const u = r % 10;
    partes.push(u ? `${DECENAS[d]} Y ${UNIDADES[u]}` : DECENAS[d]);
  }
  return partes.join(' ');
}

/** Importe en letras como lo exige el comprobante: «CIENTO VEINTE CON 50/100 SOLES». */
export function montoEnLetras(soles: number | string): string {
  const c = aCentimos(soles);
  const entero = Math.floor(c / 100);
  const centimos = String(c % 100).padStart(2, '0');
  let texto: string;
  if (entero === 0) texto = 'CERO';
  else {
    const millones = Math.floor(entero / 1_000_000);
    const miles = Math.floor((entero % 1_000_000) / 1000);
    const resto = entero % 1000;
    const partes: string[] = [];
    if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : `${hasta999(millones).replace(/UNO$/, 'UN')} MILLONES`);
    if (miles) partes.push(miles === 1 ? 'MIL' : `${hasta999(miles).replace(/UNO$/, 'UN')} MIL`);
    if (resto) partes.push(hasta999(resto));
    texto = partes.join(' ');
  }
  return `${texto} CON ${centimos}/100 SOLES`;
}
