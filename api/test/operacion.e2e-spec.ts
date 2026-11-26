import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FRANJAS_SUGERIDAS, salidaNoche } from '../src/modules/hospedaje/domain/operacion';
import { sumarDias } from '../src/modules/hospedaje/domain/tarifa';
import { fechaLima, instanteLima } from '../src/modules/reservas/domain/reserva';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies } from './utilidades';

const HORA = 3_600_000;

/** Operación real (spec 2026-11-26): franjas de salida, noche a las 9:00, cobro al ingreso y limpieza. */
describe('Operación de la sucursal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let sucursalId: number;
  let habs: Array<{ id: number; numero: string }>;
  let canalId: number;
  const turnos: Record<number, number> = {};
  let efectivo: number;
  let culqi: number;
  let siguiente = 0;
  const hoy = fechaLima(new Date());

  const http = () => request(app.getHttpServer());
  const post = (ruta: string, body: unknown = {}, c = cookie) => http().post(`/api${ruta}`).set('Cookie', c).send(body as object);
  const put = (ruta: string, body: unknown = {}, c = cookie) => http().put(`/api${ruta}`).set('Cookie', c).send(body as object);
  const get = (ruta: string, c = cookie) => http().get(`/api${ruta}`).set('Cookie', c);
  const hab = () => habs[siguiente++];

  const OPERACION = { cobroAlIngreso: true, vendeConsumos: false, minutosLimpieza: 30, horaSalidaNoche: '09:00', turnoSugeridoId: null, franjas: FRANJAS_SUGERIDAS };

  async function login(permisos: string[]) {
    const u = await crearUsuarioPrueba(prisma, { permisos });
    const res = await http().post('/api/auth/login').send({ username: u.username, password: u.password });
    expect(res.status).toBe(200);
    return encabezadoCookies(cookiesDe(res));
  }

  async function persona(): Promise<number> {
    const tipos = (await get('/clientes/tipos-documento')).body as Array<{ id: number; abreviatura: string }>;
    const numero = String(10_000_000 + Math.floor(Math.random() * 89_999_999)).slice(0, 8);
    const res = await post('/clientes', { tipoDocumentoId: tipos.find((t) => t.abreviatura === 'DNI')!.id, numeroDocumento: numero, nombres: 'Pareja', apellidos: `Operación ${numero.slice(-3)}` });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  const walkin = (habitacionId: number, clienteId: number, horas: number, cantidad = 1) => post('/estancias', { habitacionId, clienteId, canalId, turnoId: turnos[horas], cantidad });

  beforeAll(async () => {
    ({ app, prisma } = await crearApp());
    cookie = await login(['reserva.ver', 'reserva.crear', 'estancia.checkin', 'estancia.checkout', 'caja.abrir', 'habitacion.gestionar', 'cliente.gestionar', 'comprobante.emitir', 'operacion.configurar']);
    sucursalId = (await get('/auth/me')).body.sucursalId as number;
    const usados = new Set((await prisma.piso.findMany({ where: { sucursal_id: sucursalId } })).map((p) => p.numero));
    let numero = 70;
    while (usados.has(numero)) numero++;
    const doble = await prisma.tipo_habitacion.findFirstOrThrow({ where: { nombre: 'Doble' } });
    const piso = await post('/hospedaje/plano/pisos', { numero, nombre: `Piso ${numero}`, habitaciones: 8, tipoHabitacionId: doble.id });
    expect(piso.status).toBe(201);
    habs = await prisma.habitacion.findMany({ where: { piso_id: piso.body.id as number }, orderBy: { numero: 'asc' }, select: { id: true, numero: true } });
    canalId = (await prisma.canal_venta.findFirstOrThrow({ where: { nombre: 'Recepción' } })).id;
    for (const t of await prisma.turno.findMany()) turnos[t.duracion_horas] = t.id;
    const metodos = (await get('/caja/metodos-pago')).body as Array<{ id: number; codigo: string }>;
    efectivo = metodos.find((m) => m.codigo === 'EFECTIVO')!.id;
    culqi = metodos.find((m) => m.codigo === 'CULQI')!.id;
    expect([200, 201, 409]).toContain((await post('/caja/abrir', { monto: 50 })).status);
  });

  afterAll(async () => {
    if (prisma && habs) {
      await prisma.estancia.updateMany({ where: { habitacion_id: { in: habs.map((h) => h.id) }, estado: 'ACTIVA' }, data: { estado: 'ANULADA' } });
      await prisma.reserva.updateMany({ where: { reserva_habitacion: { some: { habitacion_id: { in: habs.map((h) => h.id) } } }, estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'] } }, data: { estado: 'CANCELADA' } });
      // Las demás pruebas corren con las reglas de siempre (el respaldo del seed lo devuelve el teardown global)
      await prisma.sucursal_franja_salida.deleteMany({ where: { sucursal_id: sucursalId } });
      await prisma.sucursal_operacion.deleteMany({ where: { sucursal_id: sucursalId } });
    }
    await app?.close();
  });

  it('sin configurar, la sucursal sigue las reglas de siempre', async () => {
    const res = await get('/hospedaje/operacion');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configurada: false, cobroAlIngreso: false, vendeConsumos: true, horaSalidaNoche: null, franjas: [] });
  });

  it('valida y guarda la operación; solo con el permiso', async () => {
    const sinPermiso = await login(['estancia.checkin']);
    expect((await put('/hospedaje/operacion', OPERACION, sinPermiso)).status).toBe(403);
    expect((await get('/hospedaje/operacion', sinPermiso)).status).toBe(200);
    const cruzadas = await put('/hospedaje/operacion', { ...OPERACION, franjas: [FRANJAS_SUGERIDAS[0], { ...FRANJAS_SUGERIDAS[1], desde: '05:00' }] });
    expect(cruzadas.status).toBe(400);
    expect(cruzadas.body.message).toContain('se cruzan');
    expect((await put('/hospedaje/operacion', { ...OPERACION, minutosLimpieza: 1 })).status).toBe(400);

    const res = await put('/hospedaje/operacion', { ...OPERACION, turnoSugeridoId: turnos[3] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configurada: true, cobroAlIngreso: true, vendeConsumos: false, minutosLimpieza: 30, horaSalidaNoche: '09:00', turnoSugeridoId: turnos[3] });
    expect(res.body.franjas.map((f: { nombre: string }) => f.nombre)).toEqual(['Madrugada', 'Mañana', 'Tarde y noche']);
    expect(await prisma.auditoria.count({ where: { accion: 'operacion.configurar', registro_id: BigInt(sucursalId) } })).toBeGreaterThan(0);
  });

  it('la noche o turno completo sale a las 9:00', async () => {
    const antes = new Date();
    const e = await walkin(hab().id, await persona(), 24);
    expect(e.status).toBe(201);
    expect([salidaNoche(antes, '09:00', 1).getTime(), salidaNoche(new Date(), '09:00', 1).getTime()]).toContain(new Date(e.body.salidaPrevista as string).getTime());
  });

  it('por horas suma las horas y no deja pasar la hora máxima de la franja', async () => {
    const antes = Date.now();
    const e = await walkin(hab().id, await persona(), 3);
    expect(e.status).toBe(201);
    const salida = new Date(e.body.salidaPrevista as string).getTime();
    expect(salida).toBeGreaterThanOrEqual(antes - 1000 + 3 * HORA); // la base guarda segundos enteros
    expect(salida).toBeLessThanOrEqual(Date.now() + 3 * HORA);
    // Dos turnos de 12 h (24 h) no caben en ninguna franja
    const tope = await walkin(hab().id, await persona(), 12, 2);
    expect(tope.status).toBe(400);
    expect(tope.body.message).toContain('salida máxima');
  });

  it('cobra al ingreso, cobra la extensión y el check-out solo cierra', async () => {
    const h = hab();
    const e = await walkin(h.id, await persona(), 3);
    expect(e.status).toBe(201);
    const precio = e.body.precio as string;
    expect(e.body.cuenta).toMatchObject({ saldo: precio, cobrado: '0.00', porCobrar: precio });

    const pago = await post(`/estancias/${e.body.id}/cobro`, { tipoComprobante: 'BOLETA', pagos: [{ metodoPagoId: culqi, monto: Number(precio), referencia: 'chr_test_1' }] });
    expect(pago.status).toBe(200);
    expect(pago.body).toMatchObject({ cerrada: false, total: precio, vuelto: '0.00' });
    const pagada = await get(`/estancias/${e.body.id}`);
    expect(pagada.body.estado).toBe('ACTIVA');
    expect(pagada.body.cuenta).toMatchObject({ saldo: '0.00', cobrado: precio, pendientes: [] });
    expect(pagada.body.cuenta.comprobantes).toEqual([expect.objectContaining({ numero: pago.body.comprobante })]);
    expect((await post(`/estancias/${e.body.id}/cobro`, { tipoComprobante: 'BOLETA', pagos: [] })).status).toBe(409);
    expect(await prisma.caja_movimiento.count({ where: { comprobante_pago: { comprobante_id: BigInt(pago.body.comprobanteId as number) }, metodo_pago: { codigo: 'CULQI' } } })).toBe(1);

    // Se queda un turno más: se cobra solo la diferencia
    expect((await post(`/estancias/${e.body.id}/extension`, { turnos: 1 })).status).toBe(200);
    const ext = await get(`/estancias/${e.body.id}`);
    expect(ext.body.cuenta.saldo).toBe(precio);
    expect(ext.body.cuenta.pendientes).toEqual([expect.objectContaining({ cantidad: 1, descripcion: expect.stringContaining('extensión') })]);
    // Sin elegir comprobante no se cierra con saldo
    expect((await post(`/estancias/${e.body.id}/checkout`, {})).status).toBe(400);
    const vuelto = await post(`/estancias/${e.body.id}/cobro`, { tipoComprobante: 'BOLETA', pagos: [{ metodoPagoId: efectivo, monto: Number(precio) + 10 }] });
    expect(vuelto.status).toBe(200);
    expect(vuelto.body.vuelto).toBe('10.00');

    const salida = await post(`/estancias/${e.body.id}/checkout`, {});
    expect(salida.status).toBe(200);
    expect(salida.body).toMatchObject({ cerrada: true, comprobanteId: null });
    expect((await prisma.estancia.findUniqueOrThrow({ where: { id: BigInt(e.body.id as number) } })).estado).toBe('FINALIZADA');
    expect(await prisma.comprobante.count({ where: { estancia_id: BigInt(e.body.id as number) } })).toBe(2);

    // El tablero cuenta el tiempo de limpieza con los minutos de la sucursal
    const tablero = await get('/hospedaje/tablero');
    const enTablero = (tablero.body.pisos as Array<{ habitaciones: Array<{ id: number; estado: string; limpieza: unknown }> }>).flatMap((p) => p.habitaciones).find((x) => x.id === h.id)!;
    expect(enTablero.estado).toBe('LIMPIEZA');
    expect(enTablero.limpieza).toMatchObject({ demorada: false, esperados: 30 });
  });

  it('la reserva por noche sale a las 9:00 del día siguiente', async () => {
    const manana = sumarDias(hoy, 1);
    const r = await post('/reservas', { clienteId: await persona(), canalId, turnoId: turnos[24], llegada: manana, hora: '21:00', cantidad: 1, habitaciones: [{ habitacionId: hab().id, adultos: 2 }] });
    expect(r.status).toBe(201);
    expect(new Date(r.body.entrada as string)).toEqual(instanteLima(manana, 21));
    expect(new Date(r.body.salida as string)).toEqual(instanteLima(sumarDias(manana, 1), 9));
  });

  it('la reserva por horas no pasa la hora máxima de la franja de llegada', async () => {
    const manana = sumarDias(hoy, 1);
    const r = await post('/reservas', { clienteId: await persona(), canalId, turnoId: turnos[12], llegada: manana, hora: '22:00', cantidad: 1, habitaciones: [{ habitacionId: hab().id, adultos: 2 }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('06:00 del día siguiente');
  });
});
