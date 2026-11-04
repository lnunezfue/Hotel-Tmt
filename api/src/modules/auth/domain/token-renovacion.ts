import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const MAX_LONGITUD_TOKEN = 200;
const PATRON_ID = /^[1-9]\d{0,18}$/;
const PATRON_SECRETO = /^[A-Za-z0-9_-]+$/;
const MAX_SESION_ID = 9223372036854775807n; // máximo BIGINT con signo (int64)

export function generarSecreto(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecreto(secreto: string): string {
  return createHash('sha256').update(secreto, 'utf8').digest('hex');
}

export function formatearToken(sesionId: bigint, secreto: string): string {
  return `${sesionId.toString()}.${secreto}`;
}

export function parsearToken(valor: string | undefined): { sesionId: bigint; secreto: string } | null {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > MAX_LONGITUD_TOKEN) return null;
  const separador = valor.indexOf('.');
  if (separador === -1) return null;
  const idTexto = valor.slice(0, separador);
  const secreto = valor.slice(separador + 1);
  if (!PATRON_ID.test(idTexto) || !PATRON_SECRETO.test(secreto)) return null;
  const sesionId = BigInt(idTexto);
  if (sesionId > MAX_SESION_ID) return null;
  return { sesionId, secreto };
}

export function hashesIguales(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
