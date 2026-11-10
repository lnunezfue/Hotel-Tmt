import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import request from 'supertest';
import { leerConfigRedis } from '../src/config';
import { AvisosTablero } from '../src/modules/hospedaje/application/avisos-tablero.service';
import { canalDe, mensajeDe } from '../src/modules/hospedaje/domain/aviso-tablero';
import { NotificadorTableroRedis } from '../src/modules/hospedaje/infrastructure/notificador-tablero.redis';
import { PrismaService } from '../src/prisma/prisma.service';
import { abrirFlujo, cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies, esperarHasta, Flujo } from './utilidades';

/** Spec S-05: tablero en vivo con Server-Sent Events y reparto de avisos por Redis entre réplicas. */
describe('Tablero en vivo (e2e)', () => {
  // Dos instancias de la API sobre la misma base y el mismo Redis, como las dos réplicas del DT-001 §4.6.
  let a: INestApplication;
  let b: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let cookie: string;
  let cookieOtra: string;
  let sucursalId: number;

  /** app.close() espera a los sockets abiertos: cada prueba cierra sus flujos. */
  const flujos: Flujo[] = [];
  async function abrir(app: INestApplication, c?: string): Promise<Flujo> {
    const f = await abrirFlujo(app, c);
    flujos.push(f);
    return f;
  }

  /**
   * La publicadora de cada réplica conecta al arrancar y su suscripción se activa con el primer flujo, ambas de
   * forma asíncrona. Antes de probar se espera a que un aviso cruce de `origen` a `destino`; si no, una prueba
   * negativa podría pasar solo porque la suscripción aún no estaba lista.
   */
  async function calentar(origen: INestApplication, destino: INestApplication): Promise<void> {
    const f = await abrirFlujo(destino, cookie);
    const limite = Date.now() + 15_000;
    try {
      for (;;) {
        await origen.get(AvisosTablero).avisar(sucursalId, 'estado');
        try {
          await f.esperar('tablero', 250);
          return;
        } catch {
          if (Date.now() > limite) throw new Error('Redis no repartió avisos entre las réplicas en 15 s');
        }
      }
    } finally {
      f.cerrar();
    }
  }

  beforeAll(async () => {
    ({ app: a, prisma } = await crearApp());
    ({ app: b } = await crearApp());
    redis = new Redis(leerConfigRedis().url);

    const u = await crearUsuarioPrueba(prisma, { permisos: ['habitacion.gestionar', 'habitacion.cambiar_estado', 'tarifa.editar'] });
    const login = () => request(a.getHttpServer()).post('/api/auth/login').send({ username: u.username, password: u.password });

    const r1 = await login();
    expect(r1.status).toBe(200);
    cookie = encabezadoCookies(cookiesDe(r1));
    sucursalId = r1.body.sucursalId as number;

    // Segunda sesión del mismo usuario, en otra sucursal de la empresa.
    const otra = await prisma.usuario_sucursal.findFirstOrThrow({ where: { usuario_id: u.id, sucursal_id: { not: sucursalId } } });
    const r2 = await login();
    const c2 = cookiesDe(r2);
    const cambio = await request(a.getHttpServer()).post('/api/auth/sucursal').set('Cookie', encabezadoCookies(c2)).send({ sucursalId: otra.sucursal_id });
    expect(cambio.status).toBe(200);
    cookieOtra = encabezadoCookies({ ...c2, ...cookiesDe(cambio) });

    await calentar(a, b);
    await calentar(b, a);
  }, 60_000);

  afterEach(() => {
    for (const f of flujos.splice(0)) f.cerrar();
  });

  afterAll(async () => {
    redis?.disconnect();
    await a?.close();
    await b?.close();
  });

  describe('flujo de eventos', () => {
    it('sin cookie responde 401 y no abre flujo', async () => {
      const f = await abrir(a);
      expect(f.estado).toBe(401);
    });

    it('abre un flujo de eventos que el proxy no retiene', async () => {
      const f = await abrir(a, cookie);
      expect(f.estado).toBe(200);
      expect(f.cabeceras['content-type']).toContain('text/event-stream');
      expect(f.cabeceras['cache-control']).toContain('no-cache');
      expect(f.cabeceras['cache-control']).toContain('no-transform');
      expect(f.cabeceras['x-accel-buffering']).toBe('no');
      expect(await f.esperar('latido')).toEqual({ tipo: 'latido', datos: '' });
    });

    it('un aviso publicado en una réplica llega al flujo abierto en la otra', async () => {
      const f = await abrir(b, cookie);
      await a.get(AvisosTablero).avisar(sucursalId, 'estado');
      expect(await f.esperar('tablero')).toEqual({ tipo: 'tablero', datos: '{"motivo":"estado"}' });
    });

    it('una sucursal no recibe los avisos de otra', async () => {
      const f = await abrir(a, cookieOtra);
      expect(f.estado).toBe(200);
      await b.get(AvisosTablero).avisar(sucursalId, 'estado');
      await expect(f.esperar('tablero', 750)).rejects.toThrow('No llegó');
    });

    it('descarta mensajes no válidos y sigue entregando los válidos', async () => {
      const f = await abrir(a, cookie);
      await redis.publish(canalDe(sucursalId), 'basura');
      await redis.publish(canalDe(sucursalId), '{"motivo":"otro"}');
      await redis.publish(canalDe(sucursalId), mensajeDe({ sucursalId, motivo: 'piso' }));
      expect((await f.esperar('tablero')).datos).toBe('{"motivo":"piso"}');
      await expect(f.esperar('tablero', 300)).rejects.toThrow('No llegó');
    });

    it('al cerrar el navegador se libera la suscripción del flujo', async () => {
      const n = a.get(NotificadorTableroRedis);
      const antes = n.flujosAbiertos;
      const f = await abrir(a, cookie);
      await esperarHasta(() => n.flujosAbiertos === antes + 1);
      f.cerrar();
      await esperarHasta(() => n.flujosAbiertos === antes);
    });
  });
});
