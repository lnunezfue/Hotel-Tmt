import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies } from './utilidades';

/** Spec 2026-11-24 (S-05): administración de turnos (RF-RES-08). */
describe('Turnos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  /** Turnos creados aquí: la duración es única y solo hay 24, así que se borran al final. */
  const creados: number[] = [];

  const http = () => request(app.getHttpServer());

  async function login(permisos: string[]): Promise<string> {
    const u = await crearUsuarioPrueba(prisma, { permisos });
    const res = await http().post('/api/auth/login').send({ username: u.username, password: u.password });
    expect(res.status).toBe(200);
    return encabezadoCookies(cookiesDe(res));
  }

  /** Una duración de 1 a 24 horas que ningún turno usa. */
  async function duracionLibre(): Promise<number> {
    const usadas = new Set((await prisma.turno.findMany({ select: { duracion_horas: true } })).map((t) => t.duracion_horas));
    for (let h = 23; h >= 1; h--) if (!usadas.has(h)) return h;
    throw new Error('No quedan duraciones libres para la prueba');
  }

  async function crear(datos: Record<string, unknown>) {
    const res = await http().post('/api/hospedaje/turnos').set('Cookie', cookie).send(datos);
    if (res.status === 201) creados.push(res.body.id as number);
    return res;
  }

  beforeAll(async () => {
    ({ app, prisma } = await crearApp());
    cookie = await login(['habitacion.gestionar', 'tarifa.editar']);
  });

  afterAll(async () => {
    if (prisma && creados.length) await prisma.turno.deleteMany({ where: { id: { in: creados } } });
    await app?.close();
  });

  it('crea un turno y aparece en la configuración y en las tarifas', async () => {
    const horas = await duracionLibre();
    const res = await crear({ nombre: '  Turno de prueba ', duracionHoras: horas });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nombre: 'Turno de prueba', duracionHoras: horas, activo: true });

    const config = await http().get('/api/hospedaje/config/turnos').set('Cookie', cookie);
    expect(config.status).toBe(200);
    expect(config.body).toContainEqual({ id: res.body.id, nombre: 'Turno de prueba', duracionHoras: horas, activo: true, tarifas: 0, usado: false });

    const activos = await http().get('/api/hospedaje/turnos').set('Cookie', cookie);
    expect((activos.body as Array<{ id: number }>).map((t) => t.id)).toContain(res.body.id);

    const aud = await prisma.auditoria.findMany({ where: { accion: 'turno.crear', registro_id: BigInt(res.body.id as number) } });
    expect(aud).toHaveLength(1);
  });

  it('no repite la duración', async () => {
    expect((await crear({ nombre: 'Otro día completo', duracionHoras: 24 })).status).toBe(409);
  });

  it.each([
    ['cero horas', 0],
    ['más de 24 horas', 25],
    ['fracciones de hora', 2.5],
    ['como texto', '6'],
  ])('rechaza una duración de %s con 400', async (_, duracionHoras) => {
    expect((await crear({ nombre: 'Turno inválido', duracionHoras })).status).toBe(400);
  });

  it('rechaza un nombre de una sola letra con 400', async () => {
    expect((await crear({ nombre: ' T ', duracionHoras: await duracionLibre() })).status).toBe(400);
  });

  it('edita el nombre y lo audita', async () => {
    const t = await crear({ nombre: 'Turno corto', duracionHoras: await duracionLibre() });
    const res = await http().patch(`/api/hospedaje/turnos/${t.body.id}`).set('Cookie', cookie).send({ nombre: 'Turno exprés' });
    expect(res.status).toBe(200);
    expect(res.body.nombre).toBe('Turno exprés');
    const aud = await prisma.auditoria.findMany({ where: { accion: 'turno.editar', registro_id: BigInt(t.body.id as number) } });
    expect(aud).toHaveLength(1);
  });

  it('cambia la duración de un turno que nadie usa', async () => {
    const t = await crear({ nombre: 'Turno movible', duracionHoras: await duracionLibre() });
    const nueva = await duracionLibre();
    const res = await http().patch(`/api/hospedaje/turnos/${t.body.id}`).set('Cookie', cookie).send({ duracionHoras: nueva });
    expect(res.status).toBe(200);
    expect(res.body.duracionHoras).toBe(nueva);
  });

  it('no cambia la duración de un turno que ya tiene tarifas', async () => {
    const dia = await prisma.turno.findFirstOrThrow({ where: { duracion_horas: 24 } });
    expect(await prisma.tarifa.count({ where: { turno_id: dia.id } })).toBeGreaterThan(0);
    const res = await http().patch(`/api/hospedaje/turnos/${dia.id}`).set('Cookie', cookie).send({ duracionHoras: await duracionLibre() });
    expect(res.status).toBe(409);
    expect((await prisma.turno.findUniqueOrThrow({ where: { id: dia.id } })).duracion_horas).toBe(24);

    const config = await http().get('/api/hospedaje/config/turnos').set('Cookie', cookie);
    expect(config.body).toContainEqual(expect.objectContaining({ id: dia.id, usado: true }));
  });

  it('desactivar lo quita de las tarifas pero no de la configuración', async () => {
    const t = await crear({ nombre: 'Turno a desactivar', duracionHoras: await duracionLibre() });
    const res = await http().patch(`/api/hospedaje/turnos/${t.body.id}`).set('Cookie', cookie).send({ activo: false });
    expect(res.status).toBe(200);
    const activos = await http().get('/api/hospedaje/turnos').set('Cookie', cookie);
    expect((activos.body as Array<{ id: number }>).map((x) => x.id)).not.toContain(t.body.id);
    const config = await http().get('/api/hospedaje/config/turnos').set('Cookie', cookie);
    expect(config.body).toContainEqual(expect.objectContaining({ id: t.body.id, activo: false }));
  });

  it('no deja desactivar el último turno activo', async () => {
    const antes = await prisma.turno.findMany({ select: { id: true, activo: true } });
    const t = await crear({ nombre: 'Turno único', duracionHoras: await duracionLibre() });
    try {
      await prisma.turno.updateMany({ where: { id: { not: t.body.id as number } }, data: { activo: false } });
      const res = await http().patch(`/api/hospedaje/turnos/${t.body.id}`).set('Cookie', cookie).send({ activo: false });
      expect(res.status).toBe(409);
      expect((await prisma.turno.findUniqueOrThrow({ where: { id: t.body.id as number } })).activo).toBe(true);
    } finally {
      for (const x of antes) await prisma.turno.update({ where: { id: x.id }, data: { activo: x.activo } });
    }
  });

  it('un PATCH sin cambios responde 400 y uno a un turno inexistente 404', async () => {
    const t = await crear({ nombre: 'Turno quieto', duracionHoras: await duracionLibre() });
    expect((await http().patch(`/api/hospedaje/turnos/${t.body.id}`).set('Cookie', cookie).send({})).status).toBe(400);
    expect((await http().patch('/api/hospedaje/turnos/250').set('Cookie', cookie).send({ nombre: 'Nadie' })).status).toBe(404);
  });

  it('sin tarifa.editar puede ver la configuración pero no escribir', async () => {
    const soloVer = await login(['habitacion.gestionar']);
    expect((await http().get('/api/hospedaje/config/turnos').set('Cookie', soloVer)).status).toBe(200);
    expect((await http().post('/api/hospedaje/turnos').set('Cookie', soloVer).send({ nombre: 'Sin permiso', duracionHoras: 1 })).status).toBe(403);
    const dia = await prisma.turno.findFirstOrThrow({ where: { duracion_horas: 24 } });
    expect((await http().patch(`/api/hospedaje/turnos/${dia.id}`).set('Cookie', soloVer).send({ nombre: 'Día' })).status).toBe(403);
  });
});
