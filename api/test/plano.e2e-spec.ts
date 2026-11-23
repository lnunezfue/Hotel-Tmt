import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies } from './utilidades';

/** Spec S-06 §4: plano visual por piso y comodidades por habitación. */
describe('Plano del hotel y comodidades (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let sucursalId: number;
  let tipoId: number;

  const http = () => request(app.getHttpServer());

  async function pisoLibre(): Promise<number> {
    const usados = new Set((await prisma.piso.findMany({ where: { sucursal_id: sucursalId } })).map((p) => p.numero));
    let n = 10;
    while (usados.has(n)) n++;
    return n;
  }

  beforeAll(async () => {
    ({ app, prisma } = await crearApp());
    const u = await crearUsuarioPrueba(prisma, { permisos: ['habitacion.gestionar'] });
    const res = await http().post('/api/auth/login').send({ username: u.username, password: u.password });
    cookie = encabezadoCookies(cookiesDe(res));
    sucursalId = res.body.sucursalId as number;
    tipoId = (await prisma.tipo_habitacion.findFirstOrThrow({ where: { nombre: 'Doble' } })).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('agrega un piso con sus habitaciones dibujadas alrededor del pasillo', async () => {
    const numero = await pisoLibre();
    const res = await http().post('/api/hospedaje/plano/pisos').set('Cookie', cookie).send({ numero, nombre: `Piso ${numero}`, habitaciones: 6, tipoHabitacionId: tipoId });
    expect(res.status).toBe(201);
    expect(res.body.habitaciones).toEqual([1, 2, 3, 4, 5, 6].map((k) => `${numero}0${k}`));

    const plano = await http().get('/api/hospedaje/plano').set('Cookie', cookie);
    const piso = plano.body.find((p: { id: number }) => p.id === res.body.id);
    expect(piso.elementos.map((e: { tipo: string }) => e.tipo).sort()).toEqual(['ESCALERA', 'PASILLO']);
    expect(piso.habitaciones).toHaveLength(6);
    expect(piso.habitaciones.every((h: { ubicada: boolean; estado: string }) => h.ubicada && h.estado === 'DESOCUPADA')).toBe(true);
  });

  it('guarda el plano y rechaza superposiciones nombrando las piezas', async () => {
    const numero = await pisoLibre();
    const creado = await http().post('/api/hospedaje/plano/pisos').set('Cookie', cookie).send({ numero, nombre: `Piso ${numero}`, habitaciones: 2, tipoHabitacionId: tipoId });
    const plano = (await http().get('/api/hospedaje/plano').set('Cookie', cookie)).body.find((p: { id: number }) => p.id === creado.body.id);
    const [a, b] = plano.habitaciones as Array<{ id: number; numero: string }>;

    const choque = await http()
      .put(`/api/hospedaje/plano/pisos/${plano.id}`)
      .set('Cookie', cookie)
      .send({ columnas: 12, filas: 6, habitaciones: [{ id: a.id, x: 0, y: 0, ancho: 3, alto: 2 }, { id: b.id, x: 2, y: 1, ancho: 3, alto: 2 }], elementos: [] });
    expect(choque.status).toBe(400);
    expect(choque.body.message).toBe(`Habitación ${a.numero} se superpone con habitación ${b.numero}`);

    const ok = await http()
      .put(`/api/hospedaje/plano/pisos/${plano.id}`)
      .set('Cookie', cookie)
      .send({
        columnas: 12,
        filas: 6,
        habitaciones: [{ id: a.id, x: 0, y: 0, ancho: 4, alto: 3 }, { id: b.id, x: 8, y: 0, ancho: 4, alto: 3 }],
        elementos: [{ tipo: 'PASILLO', x: 0, y: 3, ancho: 12, alto: 1 }, { tipo: 'ASCENSOR', etiqueta: 'Ascensor', x: 5, y: 0, ancho: 2, alto: 2 }],
      });
    expect(ok.status).toBe(200);
    const despues = (await http().get('/api/hospedaje/plano').set('Cookie', cookie)).body.find((p: { id: number }) => p.id === plano.id);
    expect(despues.habitaciones.find((h: { id: number }) => h.id === b.id)).toMatchObject({ x: 8, y: 0, ancho: 4, alto: 3 });
    expect(despues.elementos).toHaveLength(2);
    expect(await prisma.auditoria.count({ where: { accion: 'plano.guardar', registro_id: BigInt(plano.id as number) } })).toBe(1);
  });

  it('una habitación nueva no puede pisar otra en el plano', async () => {
    const numero = await pisoLibre();
    const creado = await http().post('/api/hospedaje/plano/pisos').set('Cookie', cookie).send({ numero, nombre: `Piso ${numero}`, habitaciones: 1, tipoHabitacionId: tipoId });
    const res = await http()
      .post('/api/hospedaje/habitaciones')
      .set('Cookie', cookie)
      .send({ numero: `${numero}99`, pisoId: creado.body.id, tipoHabitacionId: tipoId, plano: { x: 1, y: 0, ancho: 3, alto: 2 } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/se superpone/);
  });

  it('asigna comodidades a una habitación y a todas las de su tipo', async () => {
    const numero = await pisoLibre();
    const creado = await http().post('/api/hospedaje/plano/pisos').set('Cookie', cookie).send({ numero, nombre: `Piso ${numero}`, habitaciones: 2, tipoHabitacionId: tipoId });
    const habs = await prisma.habitacion.findMany({ where: { piso_id: creado.body.id as number } });

    const una = await http().put(`/api/hospedaje/habitaciones/${habs[0].id}/amenidades`).set('Cookie', cookie).send({ amenidades: ['AIRE', 'WIFI'] });
    expect(una.status).toBe(200);
    expect(una.body).toEqual({ habitaciones: 1, amenidades: ['AIRE', 'WIFI'] });
    expect((await http().put(`/api/hospedaje/habitaciones/${habs[0].id}/amenidades`).set('Cookie', cookie).send({ amenidades: ['NO_EXISTE'] })).status).toBe(400);

    const todas = await http().put(`/api/hospedaje/habitaciones/${habs[1].id}/amenidades`).set('Cookie', cookie).send({ amenidades: ['JACUZZI'], aplicarATipo: true });
    expect(todas.status).toBe(200);
    expect(todas.body.habitaciones).toBeGreaterThan(2);
    const plano = (await http().get('/api/hospedaje/plano').set('Cookie', cookie)).body.find((p: { id: number }) => p.id === creado.body.id);
    expect(plano.habitaciones.every((h: { amenidades: string[] }) => h.amenidades.join() === 'JACUZZI')).toBe(true);

    // Se deja el equipamiento de las Doble como estaba en el seed para no afectar otras pruebas ni la demo
    await http().put(`/api/hospedaje/habitaciones/${habs[1].id}/amenidades`).set('Cookie', cookie).send({ amenidades: ['WIFI', 'TV', 'AGUA_CALIENTE', 'BANO_PRIVADO', 'AIRE'], aplicarATipo: true });
  });

  it('crea comodidades propias con un dibujo del catálogo', async () => {
    const nombre = `Vista ${Date.now() % 100000}`;
    const res = await http().post('/api/hospedaje/amenidades').set('Cookie', cookie).send({ nombre, icono: 'vista' });
    expect(res.status).toBe(201);
    expect(res.body.codigo).toBe(nombre.toUpperCase().replace(' ', '_'));
    expect((await http().post('/api/hospedaje/amenidades').set('Cookie', cookie).send({ nombre: 'Otra', icono: 'cohete' })).status).toBe(400);
  });
});
