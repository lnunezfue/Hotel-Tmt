import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hoyLima, sumarDias } from '../src/modules/hospedaje/domain/tarifa';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies } from './utilidades';

/** Spec S-04 §5: pisos, tipos, habitaciones y tarifas de la sucursal del token. */
describe('Configuración del hotel (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let sucursalId: number;

  const http = () => request(app.getHttpServer());
  const sufijo = () => randomBytes(3).toString('hex');

  beforeAll(async () => {
    ({ app, prisma } = await crearApp());
    const u = await crearUsuarioPrueba(prisma, { permisos: ['habitacion.gestionar', 'tarifa.editar'] });
    const res = await http().post('/api/auth/login').send({ username: u.username, password: u.password });
    cookie = encabezadoCookies(cookiesDe(res));
    sucursalId = res.body.sucursalId as number;
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Número de piso libre en la sucursal (las pruebas se repiten sobre la misma base). */
  async function pisoLibre(): Promise<number> {
    const usados = new Set((await prisma.piso.findMany({ where: { sucursal_id: sucursalId } })).map((p) => p.numero));
    let n = 100;
    while (usados.has(n)) n++;
    return n;
  }

  async function tipoNuevo() {
    const res = await http().post('/api/hospedaje/tipos-habitacion').set('Cookie', cookie).send({ nombre: `E2E ${sufijo()}`, capacidadAdultos: 2 });
    expect(res.status).toBe(201);
    return res.body as { id: number; nombre: string };
  }

  it('sin habitacion.gestionar no se ve la configuración', async () => {
    const otro = await crearUsuarioPrueba(prisma, { permisos: ['usuario.ver'] });
    const res = await http().post('/api/auth/login').send({ username: otro.username, password: otro.password });
    const c = encabezadoCookies(cookiesDe(res));
    expect((await http().get('/api/hospedaje/config/habitaciones').set('Cookie', c)).status).toBe(403);
    expect((await http().post('/api/hospedaje/tarifas').set('Cookie', c).send({})).status).toBe(403);
  });

  it('crea un piso, rechaza el duplicado y no lo desactiva con habitaciones activas', async () => {
    const numero = await pisoLibre();
    const piso = await http().post('/api/hospedaje/pisos').set('Cookie', cookie).send({ numero, nombre: `Piso ${numero}` });
    expect(piso.status).toBe(201);
    expect((await http().post('/api/hospedaje/pisos').set('Cookie', cookie).send({ numero, nombre: 'Otro' })).status).toBe(409);

    const tipo = await tipoNuevo();
    const hab = await http()
      .post('/api/hospedaje/habitaciones')
      .set('Cookie', cookie)
      .send({ numero: `E${sufijo()}`.slice(0, 10), pisoId: piso.body.id, tipoHabitacionId: tipo.id });
    expect(hab.status).toBe(201);

    const desactivar = await http().patch(`/api/hospedaje/pisos/${piso.body.id}`).set('Cookie', cookie).send({ activo: false });
    expect(desactivar.status).toBe(409);
    expect(await prisma.auditoria.count({ where: { accion: 'piso.crear', registro_id: BigInt(piso.body.id as number) } })).toBe(1);

    // La habitación se desactiva y deja de verse en el tablero; entonces el piso sí se desactiva.
    expect((await http().patch(`/api/hospedaje/habitaciones/${hab.body.id}`).set('Cookie', cookie).send({ activo: false })).status).toBe(200);
    const tablero = await http().get('/api/hospedaje/tablero').set('Cookie', cookie);
    const ids = (tablero.body.pisos as Array<{ habitaciones: Array<{ id: number }> }>).flatMap((p) => p.habitaciones.map((h) => h.id));
    expect(ids).not.toContain(hab.body.id);
    expect((await http().patch(`/api/hospedaje/pisos/${piso.body.id}`).set('Cookie', cookie).send({ activo: false })).status).toBe(200);
  });

  it('no desactiva una habitación ocupada', async () => {
    const ocupada = await prisma.habitacion.findFirst({ where: { sucursal_id: sucursalId, activo: true, estado_habitacion: { codigo: 'OCUPADA' } } });
    if (!ocupada) return; // el seed deja habitaciones ocupadas; si no hay, no aplica
    const res = await http().patch(`/api/hospedaje/habitaciones/${ocupada.id}`).set('Cookie', cookie).send({ activo: false });
    expect(res.status).toBe(409);
  });

  it('edita el tipo de habitación y audita antes y después', async () => {
    const tipo = await tipoNuevo();
    const res = await http().patch(`/api/hospedaje/tipos-habitacion/${tipo.id}`).set('Cookie', cookie).send({ capacidadAdultos: 3, descripcion: 'Con vista' });
    expect(res.status).toBe(200);
    const aud = await prisma.auditoria.findFirstOrThrow({ where: { accion: 'tipo_habitacion.editar', registro_id: BigInt(tipo.id) } });
    expect(aud.datos_antes).toMatchObject({ capacidad_adultos: 2 });
    expect(aud.datos_despues).toMatchObject({ capacidad_adultos: 3, descripcion: 'Con vista' });
  });

  it('una tarifa nueva cierra la anterior y el precio vigente cambia en su fecha', async () => {
    const tipo = await tipoNuevo();
    const canal = await prisma.canal_venta.findFirstOrThrow({ where: { activo: true }, orderBy: { id: 'asc' } });
    const turno = await prisma.turno.findFirstOrThrow({ where: { duracion_horas: 24 } });
    const clave = { tipoId: tipo.id, canalId: canal.id, turnoId: turno.id };
    const hoy = hoyLima();
    const despues = sumarDias(hoy, 10);

    const primera = await http().post('/api/hospedaje/tarifas').set('Cookie', cookie).send({ ...clave, precio: 80 });
    expect(primera.status).toBe(201);
    expect(primera.body).toMatchObject({ precio: '80.00', desde: hoy, cerradas: [] });

    const segunda = await http().post('/api/hospedaje/tarifas').set('Cookie', cookie).send({ ...clave, precio: 95.5, desde: despues });
    expect(segunda.status).toBe(201);
    expect(segunda.body.cerradas).toEqual([{ id: primera.body.id, hasta: sumarDias(despues, -1) }]);

    const q = (fecha: string) => http().get('/api/hospedaje/tarifas/vigente').set('Cookie', cookie).query({ ...clave, fecha });
    expect((await q(hoy)).body.precio).toBe('80.00');
    expect((await q(sumarDias(despues, -1))).body.precio).toBe('80.00');
    expect((await q(despues)).body.precio).toBe('95.50');
    expect((await q(sumarDias(hoy, -1))).status).toBe(404);

    const matriz = await http().get('/api/hospedaje/tarifas').set('Cookie', cookie);
    const celda = matriz.body.celdas.find((c: { tipoId: number; canalId: number; turnoId: number }) => c.tipoId === tipo.id && c.canalId === canal.id && c.turnoId === turno.id);
    expect(celda).toMatchObject({ vigente: { precio: '80.00' }, programada: { precio: '95.50', desde: despues } });

    // Reglas: fecha pasada, fecha repetida y cambio anterior a uno programado
    expect((await http().post('/api/hospedaje/tarifas').set('Cookie', cookie).send({ ...clave, precio: 70, desde: sumarDias(hoy, -1) })).status).toBe(400);
    expect((await http().post('/api/hospedaje/tarifas').set('Cookie', cookie).send({ ...clave, precio: 70, desde: despues })).status).toBe(400);
    expect((await http().post('/api/hospedaje/tarifas').set('Cookie', cookie).send({ ...clave, precio: 70, desde: sumarDias(hoy, 5) })).status).toBe(400);
    expect((await http().post('/api/hospedaje/tarifas').set('Cookie', cookie).send({ ...clave, precio: 0 })).status).toBe(400);

    const historial = await http().get('/api/hospedaje/tarifas/historial').set('Cookie', cookie).query(clave);
    expect(historial.body.map((h: { precio: string }) => h.precio)).toEqual(['95.50', '80.00']);
    expect(await prisma.auditoria.count({ where: { accion: 'tarifa.crear', registro_id: BigInt(segunda.body.id as number) } })).toBe(1);
  });
});
