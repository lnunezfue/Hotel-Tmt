import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { NEVER } from 'rxjs';
import request from 'supertest';
import { leerConfigRedis } from '../src/config';
import { AvisosTablero } from '../src/modules/hospedaje/application/avisos-tablero.service';
import { canalDe, mensajeDe } from '../src/modules/hospedaje/domain/aviso-tablero';
import { ESTADOS, EstadoHabitacion, transicionesPermitidas } from '../src/modules/hospedaje/domain/estado-habitacion';
import { NOTIFICADOR_TABLERO } from '../src/modules/hospedaje/domain/notificador-tablero.port';
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
      expect(await f.esperar('servicio')).toEqual({ tipo: 'servicio', datos: '{"avisos":true}' });
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
      // El servidor se entera del cierre de los flujos de pruebas anteriores de forma asíncrona: se parte de cero.
      await esperarHasta(() => n.flujosAbiertos === 0);
      const f = await abrir(a, cookie);
      await esperarHasta(() => n.flujosAbiertos === 1);
      f.cerrar();
      await esperarHasta(() => n.flujosAbiertos === 0);
    });
  });

  /** Spec S-05 §4.2. Las pruebas comparten una habitación y un piso propios y corren en orden. */
  describe('avisos desde las operaciones', () => {
    let habId: number;
    let pisoId: number;
    const http = () => request(a.getHttpServer());
    const sufijo = () => randomBytes(3).toString('hex');

    async function estadoActual(): Promise<EstadoHabitacion> {
      const h = await prisma.habitacion.findUniqueOrThrow({ where: { id: habId }, include: { estado_habitacion: true } });
      return h.estado_habitacion.codigo as EstadoHabitacion;
    }

    /** Una transición permitida que no sea OCUPADA (esa exige una estancia). */
    async function siguiente(): Promise<EstadoHabitacion> {
      const nuevo = transicionesPermitidas(await estadoActual()).find((e) => e !== 'OCUPADA');
      if (!nuevo) throw new Error('La habitación de prueba quedó sin transiciones disponibles');
      return nuevo;
    }

    async function nuevoTipo(): Promise<number> {
      const res = await http().post('/api/hospedaje/tipos-habitacion').set('Cookie', cookie).send({ nombre: `E2E vivo ${sufijo()}`, capacidadAdultos: 2 });
      expect(res.status).toBe(201);
      return res.body.id as number;
    }

    afterAll(async () => {
      // El historial de estados impide borrar la habitación; desactivada, el tablero ya no la muestra.
      if (habId !== undefined) await prisma.habitacion.update({ where: { id: habId }, data: { activo: false } });
      if (pisoId !== undefined) await prisma.piso.update({ where: { id: pisoId }, data: { activo: false } });
    });

    it('crear habitación avisa con motivo habitacion', async () => {
      const sucursal = await prisma.sucursal.findUniqueOrThrow({ where: { id: sucursalId } });
      const piso = await prisma.piso.findFirstOrThrow({ where: { sucursal_id: sucursalId, activo: true }, orderBy: { numero: 'asc' } });
      const tipo = await prisma.tipo_habitacion.findFirstOrThrow({ where: { empresa_id: sucursal.empresa_id, activo: true }, orderBy: { id: 'asc' } });
      const f = await abrir(b, cookie);
      const res = await http()
        .post('/api/hospedaje/habitaciones')
        .set('Cookie', cookie)
        .send({ numero: `V${sufijo()}`, pisoId: piso.id, tipoHabitacionId: tipo.id });
      expect(res.status).toBe(201);
      habId = res.body.id as number;
      expect((await f.esperar('tablero')).datos).toBe('{"motivo":"habitacion"}');
    });

    it('cambiar su estado avisa con motivo estado', async () => {
      const f = await abrir(b, cookie);
      const res = await http().patch(`/api/hospedaje/habitaciones/${habId}/estado`).set('Cookie', cookie).send({ estado: await siguiente() });
      expect(res.status).toBe(200);
      expect((await f.esperar('tablero')).datos).toBe('{"motivo":"estado"}');
    });

    it('editar la habitación avisa con motivo habitacion', async () => {
      const f = await abrir(b, cookie);
      const res = await http().patch(`/api/hospedaje/habitaciones/${habId}`).set('Cookie', cookie).send({ descripcion: 'Prueba del tablero en vivo' });
      expect(res.status).toBe(200);
      expect((await f.esperar('tablero')).datos).toBe('{"motivo":"habitacion"}');
    });

    it('crear piso avisa con motivo piso', async () => {
      const usados = new Set((await prisma.piso.findMany({ where: { sucursal_id: sucursalId } })).map((p) => p.numero));
      let numero = 150;
      while (usados.has(numero)) numero++;
      const f = await abrir(b, cookie);
      const res = await http().post('/api/hospedaje/pisos').set('Cookie', cookie).send({ numero, nombre: `Piso ${numero}` });
      expect(res.status).toBe(201);
      pisoId = res.body.id as number;
      expect((await f.esperar('tablero')).datos).toBe('{"motivo":"piso"}');
    });

    it('editar piso avisa con motivo piso', async () => {
      const f = await abrir(b, cookie);
      const res = await http().patch(`/api/hospedaje/pisos/${pisoId}`).set('Cookie', cookie).send({ nombre: `Piso E2E ${sufijo()}` });
      expect(res.status).toBe(200);
      expect((await f.esperar('tablero')).datos).toBe('{"motivo":"piso"}');
    });

    it('editar un tipo de habitación avisa a todas las sucursales de la empresa', async () => {
      const tipoId = await nuevoTipo(); // antes de abrir los flujos: crear un tipo no avisa
      const f1 = await abrir(b, cookie);
      const f2 = await abrir(b, cookieOtra);
      const res = await http().patch(`/api/hospedaje/tipos-habitacion/${tipoId}`).set('Cookie', cookie).send({ descripcion: 'Con vista' });
      expect(res.status).toBe(200);
      expect((await f1.esperar('tablero')).datos).toBe('{"motivo":"tipo"}');
      expect((await f2.esperar('tablero')).datos).toBe('{"motivo":"tipo"}');
    });

    it('crear un tipo y programar una tarifa no avisan', async () => {
      const f = await abrir(b, cookie);
      const tipoId = await nuevoTipo();
      const canal = await prisma.canal_venta.findFirstOrThrow({ where: { activo: true }, orderBy: { id: 'asc' } });
      const turno = await prisma.turno.findFirstOrThrow({ where: { duracion_horas: 24 } });
      const tarifa = await http().post('/api/hospedaje/tarifas').set('Cookie', cookie).send({ tipoId, canalId: canal.id, turnoId: turno.id, precio: 80 });
      expect(tarifa.status).toBe(201);
      await expect(f.esperar('tablero', 750)).rejects.toThrow('No llegó');
    });

    it('una transición no permitida responde 409 y no avisa', async () => {
      const actual = await estadoActual();
      const prohibido = ESTADOS.find((e) => e !== actual && !transicionesPermitidas(actual).includes(e));
      expect(prohibido).toBeDefined();
      const f = await abrir(b, cookie);
      const res = await http().patch(`/api/hospedaje/habitaciones/${habId}/estado`).set('Cookie', cookie).send({ estado: prohibido });
      expect(res.status).toBe(409);
      await expect(f.esperar('tablero', 750)).rejects.toThrow('No llegó');
    });

    it('si el notificador falla, el cambio de estado se guarda igual', async () => {
      const caido = { publicar: () => Promise.reject(new Error('notificador caído')), escuchar: () => NEVER, disponible: () => NEVER };
      const { app: c } = await crearApp({ sustituir: [{ token: NOTIFICADOR_TABLERO, valor: caido }] });
      try {
        const nuevo = await siguiente();
        const res = await request(c.getHttpServer()).patch(`/api/hospedaje/habitaciones/${habId}/estado`).set('Cookie', cookie).send({ estado: nuevo });
        expect(res.status).toBe(200);
        expect(await estadoActual()).toBe(nuevo);
      } finally {
        await c.close();
      }
    });

    it('con Redis apagado la API arranca y atiende', async () => {
      const previo = process.env.REDIS_URL;
      process.env.REDIS_URL = 'redis://127.0.0.1:1'; // puerto sin servicio
      let c: INestApplication | undefined;
      try {
        ({ app: c } = await crearApp());
      } finally {
        if (previo === undefined) delete process.env.REDIS_URL;
        else process.env.REDIS_URL = previo;
      }
      try {
        expect((await request(c.getHttpServer()).get('/api/hospedaje/tablero').set('Cookie', cookie)).status).toBe(200);
        const nuevo = await siguiente();
        const res = await request(c.getHttpServer()).patch(`/api/hospedaje/habitaciones/${habId}/estado`).set('Cookie', cookie).send({ estado: nuevo });
        expect(res.status).toBe(200);
        expect(await estadoActual()).toBe(nuevo);
      } finally {
        await c.close();
      }
    });
  });
});
