import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { fechaLima } from '../src/modules/reservas/domain/reserva';
import { sumarDias } from '../src/modules/hospedaje/domain/tarifa';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies } from './utilidades';

const HORA = 3_600_000;

/** Spec 2026-11-25: extensión, traslado, salida tardía, libro de huéspedes, cruces y clientes. */
describe('Complementos de la estadía (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let habs: Array<{ id: number; numero: string }>;
  let canalId: number;
  let turno24: number;
  let efectivo: number;
  let siguiente = 0;
  const hoy = fechaLima(new Date());

  const http = () => request(app.getHttpServer());
  const post = (ruta: string, body: unknown = {}, c = cookie) => http().post(`/api${ruta}`).set('Cookie', c).send(body as object);
  const get = (ruta: string, c = cookie) => http().get(`/api${ruta}`).set('Cookie', c);
  const estado = async (id: number) => (await prisma.habitacion.findUniqueOrThrow({ where: { id }, include: { estado_habitacion: true } })).estado_habitacion.codigo;
  const hab = () => habs[siguiente++];

  async function login(permisos: string[]) {
    const u = await crearUsuarioPrueba(prisma, { permisos });
    const res = await http().post('/api/auth/login').send({ username: u.username, password: u.password });
    expect(res.status).toBe(200);
    return encabezadoCookies(cookiesDe(res));
  }

  async function tipoDoc(abreviatura: string) {
    const tipos = (await get('/clientes/tipos-documento')).body as Array<{ id: number; abreviatura: string }>;
    return tipos.find((t) => t.abreviatura === abreviatura)!.id;
  }

  async function persona(): Promise<number> {
    const numero = String(10_000_000 + Math.floor(Math.random() * 89_999_999)).slice(0, 8);
    const res = await post('/clientes', { tipoDocumentoId: await tipoDoc('DNI'), numeroDocumento: numero, nombres: 'Huésped', apellidos: `Estadía ${numero.slice(-3)}` });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  const walkin = async (habitacionId: number, clienteId: number, extra: Record<string, unknown> = {}) =>
    post('/estancias', { habitacionId, clienteId, canalId, turnoId: turno24, cantidad: 1, procedencia: 'Tacna, Perú', ...extra });

  const reservar = async (habitacionId: number, clienteId: number, llegada: string, cantidad = 1) =>
    post('/reservas', { clienteId, canalId, turnoId: turno24, llegada, cantidad, habitaciones: [{ habitacionId, adultos: 1 }] });

  beforeAll(async () => {
    ({ app, prisma } = await crearApp());
    cookie = await login(['reserva.ver', 'reserva.crear', 'reserva.cancelar', 'estancia.checkin', 'estancia.checkout', 'caja.abrir', 'caja.cerrar', 'habitacion.gestionar', 'habitacion.cambiar_estado', 'cliente.gestionar']);
    const yo = await get('/auth/me');
    const sucursalId = yo.body.sucursalId as number;
    const usados = new Set((await prisma.piso.findMany({ where: { sucursal_id: sucursalId } })).map((p) => p.numero));
    let numero = 80;
    while (usados.has(numero)) numero++;
    const doble = await prisma.tipo_habitacion.findFirstOrThrow({ where: { nombre: 'Doble' } });
    const piso = await post('/hospedaje/plano/pisos', { numero, nombre: `Piso ${numero}`, habitaciones: 16, tipoHabitacionId: doble.id });
    expect(piso.status).toBe(201);
    habs = await prisma.habitacion.findMany({ where: { piso_id: piso.body.id as number }, orderBy: { numero: 'asc' }, select: { id: true, numero: true } });
    canalId = (await prisma.canal_venta.findFirstOrThrow({ where: { nombre: 'Recepción' } })).id;
    turno24 = (await prisma.turno.findFirstOrThrow({ where: { duracion_horas: 24 } })).id;
    efectivo = ((await get('/caja/metodos-pago')).body as Array<{ id: number; es_efectivo: boolean }>).find((m) => m.es_efectivo)!.id;
    expect([200, 201, 409]).toContain((await post('/caja/abrir', { monto: 100 })).status);
  });

  afterAll(async () => {
    if (prisma && habs) {
      await prisma.estancia.updateMany({ where: { habitacion_id: { in: habs.map((h) => h.id) }, estado: 'ACTIVA' }, data: { estado: 'ANULADA' } });
      await prisma.reserva.updateMany({ where: { reserva_habitacion: { some: { habitacion_id: { in: habs.map((h) => h.id) } } }, estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'] } }, data: { estado: 'CANCELADA' } });
    }
    await app?.close();
  });

  it('guarda destino y motivo del viaje y los muestra en el libro de huéspedes', async () => {
    const h = hab();
    const titular = await persona();
    expect((await walkin(h.id, titular, { motivoViaje: 'Vacaciones' })).status).toBe(400);
    const e = await walkin(h.id, titular, { destino: 'Cusco', motivoViaje: 'Negocios' });
    expect(e.status).toBe(201);
    expect(e.body).toMatchObject({ destino: 'Cusco', motivoViaje: 'Negocios' });
    const libro = await get(`/libro-huespedes?desde=${hoy}&hasta=${hoy}`);
    expect(libro.status).toBe(200);
    expect(libro.body).toContainEqual(expect.objectContaining({ estanciaId: e.body.id, destino: 'Cusco', motivoViaje: 'Negocios', procedencia: 'Tacna, Perú', titular: true }));
    expect((await get(`/libro-huespedes?desde=${hoy}&hasta=${sumarDias(hoy, 40)}`)).status).toBe(400);
  });

  it('extiende la estadía si la habitación sigue libre y no si choca con una reserva', async () => {
    const h = hab();
    const e = await walkin(h.id, await persona());
    expect(e.status).toBe(201);
    const ext = await post(`/estancias/${e.body.id}/extension`, { turnos: 1 });
    expect(ext.status).toBe(200);
    expect(ext.body.cantidad).toBe(2);
    expect(new Date(ext.body.salidaPrevista as string).getTime()).toBe(new Date(e.body.salidaPrevista as string).getTime() + 24 * HORA);
    expect(await prisma.auditoria.count({ where: { accion: 'estancia.extender', registro_id: BigInt(e.body.id as number) } })).toBe(1);

    // Llega alguien el día en que ahora sale: entra a las 14:00, después de la salida de las 12:00
    expect((await reservar(h.id, await persona(), sumarDias(hoy, 2))).status).toBe(201);
    expect((await post(`/estancias/${e.body.id}/extension`, { turnos: 1 })).status).toBe(409);
    expect((await post(`/estancias/${e.body.id}/extension`, { turnos: 0 })).status).toBe(400);
  });

  it('no reserva sobre una estadía en curso ni hace un walk-in sobre una reserva por llegar', async () => {
    const ocupada = hab();
    expect((await walkin(ocupada.id, await persona(), { cantidad: 2 })).status).toBe(201);
    const choque = await reservar(ocupada.id, await persona(), sumarDias(hoy, 1));
    expect(choque.status).toBe(409);
    expect(choque.body.message).toContain('ocupada');

    const reservada = hab();
    expect((await reservar(reservada.id, await persona(), sumarDias(hoy, 1))).status).toBe(201);
    const largo = await walkin(reservada.id, await persona(), { cantidad: 2 });
    expect(largo.status).toBe(409);
    expect(largo.body.message).toContain('ya está reservada');
    expect((await walkin(reservada.id, await persona())).status).toBe(201); // sale mañana a las 12:00, antes de la llegada
  });

  it('un huésped no se aloja en dos habitaciones ni una empresa se aloja', async () => {
    const titular = await persona();
    expect((await walkin(hab().id, titular)).status).toBe(201);
    expect((await walkin(hab().id, titular)).status).toBe(409);

    const ruc = await post('/clientes', { tipoDocumentoId: await tipoDoc('RUC'), numeroDocumento: '20100047218', razonSocial: 'Empresa Estadía E2E' });
    const empresaId = ruc.status === 201 ? (ruc.body.id as number) : Number((await prisma.cliente.findFirstOrThrow({ where: { numero_documento: '20100047218' } })).id);
    expect((await walkin(hab().id, empresaId)).status).toBe(400);
  });

  it('cobra los turnos consumidos si el huésped sale pasada la tolerancia', async () => {
    const h = hab();
    const e = await walkin(h.id, await persona());
    const ingreso = new Date(Date.now() - 30 * HORA);
    await prisma.estancia.update({ where: { id: e.body.id as number }, data: { checkin_at: ingreso, checkout_previsto: new Date(Date.now() - 2 * HORA) } });

    const cuenta = (await get(`/estancias/${e.body.id}`)).body.cuenta as { lineas: Array<{ cantidad: number; descripcion: string }>; saldo: string };
    expect(cuenta.lineas[0].cantidad).toBe(2);
    expect(cuenta.lineas[0].descripcion).toContain('salida tardía');

    const fin = await post(`/estancias/${e.body.id}/checkout`, { tipoComprobante: 'INTERNO', pagos: [{ metodoPagoId: efectivo, monto: Number(cuenta.saldo) }] });
    expect(fin.status).toBe(200);
    expect((await prisma.estancia.findUniqueOrThrow({ where: { id: e.body.id as number } })).cantidad_turnos).toBe(2);
  });

  it('traslada al huésped con su motivo: la habitación que deja pasa a limpieza', async () => {
    const origen = hab();
    const destino = hab();
    const e = await walkin(origen.id, await persona());
    expect((await post(`/estancias/${e.body.id}/traslado`, { habitacionId: origen.id, motivo: 'Fuga de agua' })).status).toBe(400);
    expect((await post(`/estancias/${e.body.id}/traslado`, { habitacionId: destino.id, motivo: 'no' })).status).toBe(400);

    const t = await post(`/estancias/${e.body.id}/traslado`, { habitacionId: destino.id, motivo: 'Fuga de agua en el baño' });
    expect(t.status).toBe(200);
    expect(t.body.habitacion.numero).toBe(destino.numero);
    expect(await estado(origen.id)).toBe('LIMPIEZA');
    expect(await estado(destino.id)).toBe('OCUPADA');
    expect(await prisma.estancia_traslado.count({ where: { estancia_id: BigInt(e.body.id as number), motivo: 'Fuga de agua en el baño' } })).toBe(1);
    expect(await prisma.auditoria.count({ where: { accion: 'estancia.traslado', registro_id: BigInt(e.body.id as number) } })).toBe(1);

    // A una habitación ocupada no se traslada
    const otra = await walkin(hab().id, await persona());
    expect((await post(`/estancias/${otra.body.id}/traslado`, { habitacionId: destino.id, motivo: 'Prefiere otro piso' })).status).toBe(409);
  });

  it('la cancelación y el no-show guardan motivo y responsable', async () => {
    const r = await reservar(hab().id, await persona(), hoy);
    expect(r.status).toBe(201);
    expect((await post(`/reservas/${r.body.id}/no-show`, {})).status).toBe(400);
    const ns = await post(`/reservas/${r.body.id}/no-show`, { motivo: 'No llegó ni avisó' });
    expect(ns.status).toBe(200);
    expect(ns.body).toMatchObject({ estado: 'NO_SHOW', motivoCancelacion: 'No llegó ni avisó' });
    expect(ns.body.canceladaPor).toMatch(/^e2e_/);
    expect(ns.body.canceladaEn).toBeTruthy();
  });

  it('la habitación no se ocupa ni se libera a mano', async () => {
    const libre = hab();
    expect((await http().patch(`/api/hospedaje/habitaciones/${libre.id}/estado`).set('Cookie', cookie).send({ estado: 'OCUPADA' })).status).toBe(409);
    const conHuesped = hab();
    await walkin(conHuesped.id, await persona());
    expect((await http().patch(`/api/hospedaje/habitaciones/${conHuesped.id}/estado`).set('Cookie', cookie).send({ estado: 'LIMPIEZA' })).status).toBe(409);
  });

  describe('Clientes', () => {
    it('edita los datos, pero no el documento de un cliente con historia', async () => {
      const id = await persona();
      const ok = await http().patch(`/api/clientes/${id}`).set('Cookie', cookie).send({ nombres: 'Huésped editado', email: 'huesped@hotel.pe', sexo: 'F' });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ nombres: 'Huésped editado', email: 'huesped@hotel.pe', sexo: 'F' });
      expect(await prisma.auditoria.count({ where: { accion: 'cliente.editar', registro_id: BigInt(id) } })).toBe(1);

      expect((await reservar(hab().id, id, sumarDias(hoy, 20))).status).toBe(201);
      const doc = await http().patch(`/api/clientes/${id}`).set('Cookie', cookie).send({ numeroDocumento: '12345678' });
      expect(doc.status).toBe(409);
    });

    it('caja gestiona clientes sin poder reservar', async () => {
      const caja = await login(['cliente.gestionar']);
      expect((await get('/clientes/cartera', caja)).status).toBe(200);
      const id = await persona();
      expect((await http().patch(`/api/clientes/${id}`).set('Cookie', caja).send({ telefono: '952 000 111' })).status).toBe(200);
      expect((await post('/reservas', {}, caja)).status).toBe(403);
    });
  });
});
