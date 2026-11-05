import { Prisma } from '@prisma/client';

const CLAVE_SENSIBLE = /password|hash|token|secreto|clave/i;

/** Copia el valor listo para guardarse como JSON: oculta secretos y convierte tipos no serializables. */
export function sanitizar(valor: unknown): unknown {
  if (valor === undefined || valor === null) return valor;
  if (typeof valor === 'bigint') return valor.toString();
  if (valor instanceof Date) return valor.toISOString();
  if (Prisma.Decimal.isDecimal(valor)) return (valor as Prisma.Decimal).toString();
  if (Array.isArray(valor)) return valor.map(sanitizar);
  if (typeof valor === 'object') {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      salida[k] = CLAVE_SENSIBLE.test(k) ? '[oculto]' : sanitizar(v);
    }
    return salida;
  }
  return valor;
}
