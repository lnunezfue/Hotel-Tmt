import { randomBytes } from 'node:crypto';
import http, { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
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
export async function crearApp(extra?: {
  controllers?: Type[];
  /** Proveedores reemplazados por un valor fijo (p. ej. un notificador que falla). */
  sustituir?: Array<{ token: string | symbol | Type; valor: unknown }>;
}): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const constructor = Test.createTestingModule({ imports: [AppModule], controllers: extra?.controllers ?? [] });
  for (const s of extra?.sustituir ?? []) constructor.overrideProvider(s.token).useValue(s.valor);
  const modulo = await constructor.compile();
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

export interface EventoRecibido {
  tipo: string;
  datos: string;
}

export interface Flujo {
  /** Código HTTP de la respuesta. */
  estado: number;
  cabeceras: IncomingHttpHeaders;
  /** Siguiente evento de ese tipo aún no entregado; rechaza si no llega en `ms`. */
  esperar(tipo: string, ms?: number): Promise<EventoRecibido>;
  cerrar(): void;
}

/** Interpreta un bloque SSE; los que no traen evento ni datos (el salto inicial, comentarios) se ignoran. */
function leerBloque(bloque: string): EventoRecibido | null {
  let tipo = 'message';
  const datos: string[] = [];
  let hay = false;
  for (const linea of bloque.split(/\r?\n/)) {
    if (linea.startsWith('event:')) {
      tipo = linea.slice(6).trim();
      hay = true;
    } else if (linea.startsWith('data:')) {
      datos.push(linea.slice(5).replace(/^ /, ''));
      hay = true;
    }
  }
  return hay ? { tipo, datos: datos.join(String.fromCharCode(10)) } : null;
}

/**
 * Abre el flujo de eventos del tablero como lo haría un navegador. Resuelve al recibir las cabeceras: Nest las
 * envía con el primer evento, que es el latido inicial.
 */
export async function abrirFlujo(app: INestApplication, cookie?: string): Promise<Flujo> {
  const servidor = app.getHttpServer() as http.Server;
  if (!servidor.listening) await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', () => r()));
  const { port } = servidor.address() as AddressInfo;

  const pendientes: EventoRecibido[] = [];
  const esperas: Array<{ tipo: string; resolver: (e: EventoRecibido) => void }> = [];
  const entregar = (e: EventoRecibido) => {
    const i = esperas.findIndex((x) => x.tipo === e.tipo);
    if (i === -1) pendientes.push(e);
    else esperas.splice(i, 1)[0].resolver(e);
  };

  return new Promise<Flujo>((resolver, rechazar) => {
    const peticion = http.get(
      {
        host: '127.0.0.1',
        port,
        path: '/api/hospedaje/tablero/eventos',
        headers: { Accept: 'text/event-stream', ...(cookie ? { Cookie: cookie } : {}) },
      },
      (res) => {
        res.setEncoding('utf8');
        let resto = '';
        res.on('data', (trozo: string) => {
          resto += trozo;
          const bloques = resto.split(/\r?\n\r?\n/);
          resto = bloques.pop() ?? '';
          for (const b of bloques) {
            const e = leerBloque(b);
            if (e) entregar(e);
          }
        });
        res.on('error', () => undefined); // cerrar() destruye la conexión a propósito
        const estado = res.statusCode ?? 0;
        resolver({
          estado,
          cabeceras: res.headers,
          esperar(tipo, ms = 2000) {
            if (estado !== 200) return Promise.reject(new Error(`El flujo respondió ${estado}`));
            const i = pendientes.findIndex((e) => e.tipo === tipo);
            if (i !== -1) return Promise.resolve(pendientes.splice(i, 1)[0]);
            return new Promise<EventoRecibido>((ok, falla) => {
              const espera = {
                tipo,
                resolver: (e: EventoRecibido) => {
                  clearTimeout(reloj);
                  ok(e);
                },
              };
              const reloj = setTimeout(() => {
                esperas.splice(esperas.indexOf(espera), 1);
                falla(new Error(`No llegó un evento «${tipo}» en ${ms} ms`));
              }, ms);
              esperas.push(espera);
            });
          },
          cerrar() {
            peticion.destroy();
          },
        });
      },
    );
    peticion.on('error', rechazar); // tras resolver, rechazar ya no tiene efecto (p. ej. el error de destroy())
  });
}

/** Sondea `condicion` hasta que se cumpla; rechaza pasados `ms`. */
export async function esperarHasta(condicion: () => boolean, ms = 2000): Promise<void> {
  const limite = Date.now() + ms;
  while (!condicion()) {
    if (Date.now() > limite) throw new Error(`La condición no se cumplió en ${ms} ms`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
