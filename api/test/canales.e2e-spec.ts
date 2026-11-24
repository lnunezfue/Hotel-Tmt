import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies } from './utilidades';

/** Spec 2026-11-12 (S-05): administración de canales de venta (RF-RES-07). */
describe('Canales de venta (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let empresaId: number;

  const http = () => request(app.getHttpServer());
  const nombre = () => `E2E canal ${randomBytes(3).toString('hex')}`;

  async function login(permisos: string[]): Promise<string> {
    const u = await crearUsuarioPrueba(prisma, { permisos });
    const res = await http().post('/api/auth/login').send({ username: u.username, password: u.password });
    expect(res.status).toBe(200);
    return encabezadoCookies(cookiesDe(res));
  }

  async function crear(datos: Record<string, unknown>) {
    return http().post('/api/hospedaje/canales').set('Cookie', cookie).send(datos);
  }

  beforeAll(async () => {
    ({ app, prisma } = await crearApp());
    cookie = await login(['habitacion.gestionar', 'tarifa.editar']);
    empresaId = (await prisma.empresa.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('crea un canal y aparece en la configuración y en las tarifas', async () => {
    const n = nombre();
    const res = await crear({ nombre: `  ${n} `, comisionPorcentaje: 12.5, esOta: true });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nombre: n, comisionPorcentaje: '12.50', esOta: true, activo: true });

    const config = await http().get('/api/hospedaje/config/canales').set('Cookie', cookie);
    expect(config.status).toBe(200);
    expect(config.body).toContainEqual({ id: res.body.id, nombre: n, comisionPorcentaje: '12.50', esOta: true, activo: true, tarifas: 0 });

    const activos = await http().get('/api/hospedaje/canales').set('Cookie', cookie);
    expect((activos.body as Array<{ id: number }>).map((c) => c.id)).toContain(res.body.id);

    const aud = await prisma.auditoria.findMany({ where: { accion: 'canal_venta.crear', registro_id: BigInt(res.body.id as number) } });
    expect(aud).toHaveLength(1);
  });

  it('esOta es opcional al crear y vale false', async () => {
    const res = await crear({ nombre: nombre(), comisionPorcentaje: 0 });
    expect(res.status).toBe(201);
    expect(res.body.esOta).toBe(false);
  });

  it('no repite nombres, ni al crear ni al renombrar', async () => {
    const n = nombre();
    expect((await crear({ nombre: n, comisionPorcentaje: 0 })).status).toBe(201);
    expect((await crear({ nombre: n, comisionPorcentaje: 5 })).status).toBe(409);

    const otro = await crear({ nombre: nombre(), comisionPorcentaje: 0 });
    const renombrar = await http().patch(`/api/hospedaje/canales/${otro.body.id}`).set('Cookie', cookie).send({ nombre: n });
    expect(renombrar.status).toBe(409);
  });

  it.each([
    ['mayor que 100', 100.01],
    ['con tres decimales', 12.345],
    ['negativa', -1],
    ['como texto', '15'],
  ])('rechaza una comisión %s con 400', async (_, comisionPorcentaje) => {
    expect((await crear({ nombre: nombre(), comisionPorcentaje })).status).toBe(400);
  });

  it('rechaza un nombre de una sola letra con 400', async () => {
    expect((await crear({ nombre: ' B ', comisionPorcentaje: 0 })).status).toBe(400);
  });

  it('edita la comisión y lo audita', async () => {
    const c = await crear({ nombre: nombre(), comisionPorcentaje: 15 });
    const res = await http().patch(`/api/hospedaje/canales/${c.body.id}`).set('Cookie', cookie).send({ comisionPorcentaje: 18 });
    expect(res.status).toBe(200);
    expect(res.body.comisionPorcentaje).toBe('18.00');
    const aud = await prisma.auditoria.findMany({ where: { accion: 'canal_venta.editar', registro_id: BigInt(c.body.id as number) } });
    expect(aud).toHaveLength(1);
  });

  it('un PATCH sin cambios responde 400', async () => {
    const c = await crear({ nombre: nombre(), comisionPorcentaje: 0 });
    expect((await http().patch(`/api/hospedaje/canales/${c.body.id}`).set('Cookie', cookie).send({})).status).toBe(400);
  });

  it('desactivar lo quita de las tarifas pero no de la configuración', async () => {
    const c = await crear({ nombre: nombre(), comisionPorcentaje: 0 });
    const res = await http().patch(`/api/hospedaje/canales/${c.body.id}`).set('Cookie', cookie).send({ activo: false });
    expect(res.status).toBe(200);
    const activos = await http().get('/api/hospedaje/canales').set('Cookie', cookie);
    expect((activos.body as Array<{ id: number }>).map((x) => x.id)).not.toContain(c.body.id);
    const config = await http().get('/api/hospedaje/config/canales').set('Cookie', cookie);
    expect(config.body).toContainEqual(expect.objectContaining({ id: c.body.id, activo: false }));
  });

  it('no deja desactivar el último canal activo de la empresa', async () => {
    const antes = await prisma.canal_venta.findMany({ where: { empresa_id: empresaId }, select: { id: true, activo: true } });
    const c = await crear({ nombre: nombre(), comisionPorcentaje: 0 });
    try {
      await prisma.canal_venta.updateMany({ where: { empresa_id: empresaId, id: { not: c.body.id as number } }, data: { activo: false } });
      const res = await http().patch(`/api/hospedaje/canales/${c.body.id}`).set('Cookie', cookie).send({ activo: false });
      expect(res.status).toBe(409);
      expect((await prisma.canal_venta.findUniqueOrThrow({ where: { id: c.body.id as number } })).activo).toBe(true);
    } finally {
      for (const x of antes) await prisma.canal_venta.update({ where: { id: x.id }, data: { activo: x.activo } });
    }
  });

  it('un canal inexistente responde 404', async () => {
    expect((await http().patch('/api/hospedaje/canales/60000').set('Cookie', cookie).send({ comisionPorcentaje: 1 })).status).toBe(404);
  });

  it('sin tarifa.editar puede ver la configuración pero no escribir', async () => {
    const soloVer = await login(['habitacion.gestionar']);
    expect((await http().get('/api/hospedaje/config/canales').set('Cookie', soloVer)).status).toBe(200);
    expect((await http().post('/api/hospedaje/canales').set('Cookie', soloVer).send({ nombre: nombre(), comisionPorcentaje: 0 })).status).toBe(403);
    const c = await crear({ nombre: nombre(), comisionPorcentaje: 0 });
    expect((await http().patch(`/api/hospedaje/canales/${c.body.id}`).set('Cookie', soloVer).send({ comisionPorcentaje: 1 })).status).toBe(403);
  });

  it('sin habitacion.gestionar no ve la configuración de canales', async () => {
    const otro = await login(['usuario.ver']);
    expect((await http().get('/api/hospedaje/config/canales').set('Cookie', otro)).status).toBe(403);
  });
});
