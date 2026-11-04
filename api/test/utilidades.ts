import { randomBytes } from 'node:crypto';
import { INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import type request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { PrismaService } from '../src/prisma/prisma.service';

export const CLAVE_PRUEBA = 'Clave-e2e-1';

/** Levanta la app completa (mismo arranque que main.ts) contra la base real. */
export async function crearApp(extra?: { controllers?: Type[] }): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const modulo = await Test.createTestingModule({ imports: [AppModule], controllers: extra?.controllers ?? [] }).compile();
  const app = modulo.createNestApplication<NestExpressApplication>();
  configurarApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

function aleatorio(): string {
  return randomBytes(6).toString('hex');
}

/** Crea un rol y un usuario propios de la prueba (prefijo e2e_); nunca toca los usuarios del seed. */
export async function crearUsuarioPrueba(
  prisma: PrismaService,
  o?: { permisos?: string[]; sucursales?: 'todas' | 'ninguna' },
): Promise<{ id: number; username: string; password: string; rolId: number }> {
  const empresa = await prisma.empresa.findFirstOrThrow({ orderBy: { id: 'asc' } });
  const codigos = o?.permisos ?? ['usuario.ver'];
  const permisos = await prisma.permiso.findMany({ where: { codigo: { in: codigos } } });
  if (permisos.length !== codigos.length) throw new Error(`Permisos inexistentes en el seed: ${codigos.join(', ')}`);
  const rol = await prisma.rol.create({
    data: { nombre: `e2e_${aleatorio()}`, rol_permiso: { create: permisos.map((p) => ({ permiso_id: p.id })) } },
  });
  const sucursales =
    (o?.sucursales ?? 'todas') === 'todas'
      ? await prisma.sucursal.findMany({ where: { empresa_id: empresa.id }, orderBy: { id: 'asc' } })
      : [];
  const username = `e2e_${aleatorio()}`;
  const usuario = await prisma.usuario.create({
    data: {
      empresa_id: empresa.id,
      rol_id: rol.id,
      username,
      password_hash: await argon2.hash(CLAVE_PRUEBA, { type: argon2.argon2id }),
      nombres: 'Prueba',
      apellidos: 'E2E',
      usuario_sucursal: { create: sucursales.map((s, i) => ({ sucursal_id: s.id, es_principal: i === 0 })) },
    },
  });
  return { id: usuario.id, username, password: CLAVE_PRUEBA, rolId: rol.id };
}

/** Cookies fijadas por una respuesta (`nombre → valor`; una cookie borrada queda con valor vacío). */
export function cookiesDe(res: request.Response): Record<string, string> {
  const crudo = res.headers['set-cookie'] as unknown;
  const lista = Array.isArray(crudo) ? (crudo as string[]) : typeof crudo === 'string' ? [crudo] : [];
  const resultado: Record<string, string> = {};
  for (const linea of lista) {
    const par = linea.split(';')[0];
    const igual = par.indexOf('=');
    if (igual === -1) continue;
    resultado[par.slice(0, igual).trim()] = decodeURIComponent(par.slice(igual + 1).trim());
  }
  return resultado;
}

/** Arma el encabezado `Cookie` a partir de un mapa `nombre → valor`. */
export function encabezadoCookies(c: Record<string, string>): string {
  return Object.entries(c)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('; ');
}
