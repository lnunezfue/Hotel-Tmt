import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { fechaLima } from '../src/modules/reservas/domain/reserva';
import { sumarDias } from '../src/modules/hospedaje/domain/tarifa';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies } from './utilidades';

/** Spec S-06 §5: disponibilidad, alta con precio vigente, solape, estados y check-in. */
describe('Reservas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let sucursalId: number;
  let habs: Array<{ id: number; numero: string }>;
  let clienteId: number;
  let canalId: number;
  let turno24: number;
  const hoy = fechaLima(new Date());

  const http = () => request(app.getHttpServer());
  const reservar = (extra: Record<string, unknown> = {}) =>
    http().post('/api/reservas').set('Cookie', cookie).send({ clienteId, canalId, turnoId: turno24, habitacionId: habs[0].id, llegada: sumarDias(hoy, 3), cantidad: 2, adultos: 2, ...extra });

  beforeAll(async () => {
    ({ app, prisma } = await crearApp());
    const u = await crearUsuarioPrueba(prisma, { permisos: ['reserva.ver', 'reserva.crear', 'reserva.cancelar', 'estancia.checkin', 'habitacion.gestionar'] });
    const res = await http().post('/api/auth/login').send({ username: u.username, password: u.password });
    cookie = encabezadoCookies(cookiesDe(res));
    sucursalId = res.body.sucursalId as number;

    // Un piso propio para no chocar con la demo ni con corridas anteriores
    const usados = new Set((await prisma.piso.findMany({ where: { sucursal_id: sucursalId } })).map((p) => p.numero));
    let numero = 40;
    while (usados.has(numero)) numero++;
    const doble = await prisma.tipo_habitacion.findFirstOrThrow({ where: { nombre: 'Doble' } });
    const piso = await http().post('/api/hospedaje/plano/pisos').set('Cookie', cookie).send({ numero, nombre: `Piso ${numero}`, habitaciones: 3, tipoHabitacionId: doble.id });
    expect(piso.status).toBe(201);
    habs = await prisma.habitacion.findMany({ where: { piso_id: piso.body.id as number }, orderBy: { numero: 'asc' }, select: { id: true, numero: true } });

    const tipos = await http().get('/api/clientes/tipos-documento').set('Cookie', cookie);
    const dni = tipos.body.find((t: { abreviatura: string }) => t.abreviatura === 'DNI');
    const doc = String(10_000_000 + Math.floor(Math.random() * 89_999_999)).slice(0, 8);
    const cli = await http().post('/api/clientes').set('Cookie', cookie).send({ tipoDocumentoId: dni.id, numeroDocumento: doc, nombres: 'Elena', apellidos: 'Prueba Reserva' });
    expect(cli.status).toBe(201);
    clienteId = cli.body.id as number;
    expect((await http().get('/api/clientes').query({ q: doc.slice(0, 5) }).set('Cookie', cookie)).body.some((c: { id: number }) => c.id === clienteId)).toBe(true);

    canalId = (await prisma.canal_venta.findFirstOrThrow({ where: { nombre: 'Recepción' } })).id;
    turno24 = (await prisma.turno.findFirstOrThrow({ where: { duracion_horas: 24 } })).id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reserva con el precio vigente y bloquea las fechas que se cruzan', async () => {
    const res = await reservar();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ estado: 'PENDIENTE', total: '220.00', habitaciones: [{ numero: habs[0].numero, precio: '110.00', cantidad: 2 }] });
    expect(res.body.codigo).toMatch(/^R-\d{6}$/);

    const cruce = await reservar({ llegada: sumarDias(hoy, 4), cantidad: 1 });
    expect(cruce.status).toBe(409);
    expect(cruce.body.message).toMatch(/ya está reservada/);
    // Sale a las 12:00 y el siguiente entra a las 14:00 del mismo día: sí se puede
    expect((await reservar({ llegada: sumarDias(hoy, 5), cantidad: 1 })).status).toBe(201);

    const disp = await http().get('/api/reservas/disponibilidad').query({ llegada: sumarDias(hoy, 4), cantidad: 1, turnoId: turno24 }).set('Cookie', cookie);
    const h0 = disp.body.habitaciones.find((h: { id: number }) => h.id === habs[0].id);
    const h1 = disp.body.habitaciones.find((h: { id: number }) => h.id === habs[1].id);
    expect(h0).toMatchObject({ libre: false });
    expect(h0.motivo).toContain(res.body.codigo);
    expect(h1).toMatchObject({ libre: true });

    const cal = await http().get('/api/reservas').query({ desde: hoy, hasta: sumarDias(hoy, 7) }).set('Cookie', cookie);
    expect(cal.body.some((r: { id: number }) => r.id === res.body.id)).toBe(true);
  });

  it('respeta la capacidad de la habitación', async () => {
    const res = await reservar({ habitacionId: habs[1].id, adultos: 3 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/2 adultos/);
  });

  it('cancelar exige motivo y libera las fechas', async () => {
    const r = await reservar({ habitacionId: habs[1].id, llegada: sumarDias(hoy, 10), cantidad: 1 });
    expect((await http().post(`/api/reservas/${r.body.id}/cancelar`).set('Cookie', cookie).send({ motivo: '' })).status).toBe(400);
    const c = await http().post(`/api/reservas/${r.body.id}/cancelar`).set('Cookie', cookie).send({ motivo: 'Cambio de planes del huésped' });
    expect(c.status).toBe(200);
    expect(c.body.estado).toBe('CANCELADA');
    expect((await reservar({ habitacionId: habs[1].id, llegada: sumarDias(hoy, 10), cantidad: 1 })).status).toBe(201);
    expect(await prisma.auditoria.count({ where: { accion: 'reserva.cancelar', registro_id: BigInt(r.body.id as number) } })).toBe(1);
  });

  it('llegada de hoy: la habitación pasa a RESERVADA, se confirma y el check-in la ocupa', async () => {
    const r = await reservar({ habitacionId: habs[2].id, llegada: hoy, cantidad: 1, adultos: 1 });
    expect(r.status).toBe(201);
    const estado = async () => (await prisma.habitacion.findUniqueOrThrow({ where: { id: habs[2].id }, include: { estado_habitacion: true } })).estado_habitacion.codigo;
    expect(await estado()).toBe('RESERVADA');

    expect((await http().post(`/api/reservas/${r.body.id}/confirmar`).set('Cookie', cookie)).body.estado).toBe('CONFIRMADA');
    expect(await estado()).toBe('CONFIRMADA');

    const ci = await http().post(`/api/reservas/${r.body.id}/checkin`).set('Cookie', cookie).send({ procedencia: 'Arequipa' });
    expect(ci.status).toBe(200);
    expect(ci.body.estado).toBe('EN_CURSO');
    expect(await estado()).toBe('OCUPADA');
    const est = await prisma.estancia.findFirstOrThrow({ where: { habitacion_id: habs[2].id, estado: 'ACTIVA' }, include: { estancia_huesped: true } });
    expect(est.precio_unitario.toFixed(2)).toBe('110.00');
    expect(est.estancia_huesped[0]).toMatchObject({ cliente_id: BigInt(clienteId), es_titular: true });
    expect((await http().post(`/api/reservas/${r.body.id}/cancelar`).set('Cookie', cookie).send({ motivo: 'tarde' })).status).toBe(400);
  });

  it('no permite el check-in antes del día de llegada', async () => {
    const r = await reservar({ habitacionId: habs[1].id, llegada: sumarDias(hoy, 20), cantidad: 1 });
    const ci = await http().post(`/api/reservas/${r.body.id}/checkin`).set('Cookie', cookie).send({});
    expect(ci.status).toBe(400);
    expect(ci.body.message).toMatch(/check-in de esta reserva es desde/);
  });

  it('sin reserva.crear no se reserva', async () => {
    const lector = await crearUsuarioPrueba(prisma, { permisos: ['reserva.ver'] });
    const res = await http().post('/api/auth/login').send({ username: lector.username, password: lector.password });
    const c = encabezadoCookies(cookiesDe(res));
    expect((await http().post('/api/reservas').set('Cookie', c).send({})).status).toBe(403);
    expect((await http().get('/api/reservas').query({ desde: hoy, hasta: hoy }).set('Cookie', c)).status).toBe(200);
  });
});
