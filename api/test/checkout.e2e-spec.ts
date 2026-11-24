import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { fechaLima } from '../src/modules/reservas/domain/reserva';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies } from './utilidades';

/** Spec S-07: el proceso completo de una familia en dos habitaciones, más un huésped sin reserva. */
describe('Check-out con cobro (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let sucursalId: number;
  let habs: Array<{ id: number; numero: string }>;
  let canalId: number;
  let turno24: number;
  let turno6: number;
  const metodo: Record<string, number> = {};
  const hoy = fechaLima(new Date());

  const http = () => request(app.getHttpServer());
  const post = (ruta: string, body: unknown = {}) => http().post(`/api${ruta}`).set('Cookie', cookie).send(body as object);
  const get = (ruta: string) => http().get(`/api${ruta}`).set('Cookie', cookie);
  const estado = async (id: number) => (await prisma.habitacion.findUniqueOrThrow({ where: { id }, include: { estado_habitacion: true } })).estado_habitacion.codigo;

  async function cliente(tipo: string, numero: string, datos: Record<string, string>) {
    const tipos = (await get('/clientes/tipos-documento')).body as Array<{ id: number; abreviatura: string }>;
    const res = await post('/clientes', { tipoDocumentoId: tipos.find((t) => t.abreviatura === tipo)!.id, numeroDocumento: numero, ...datos });
    if (res.status === 409) return Number((await prisma.cliente.findFirstOrThrow({ where: { numero_documento: numero } })).id);
    expect(res.status).toBe(201);
    return res.body.id as number;
  }
  const doc = () => String(10_000_000 + Math.floor(Math.random() * 89_999_999)).slice(0, 8);

  beforeAll(async () => {
    ({ app, prisma } = await crearApp());
    const u = await crearUsuarioPrueba(prisma, {
      permisos: ['reserva.ver', 'reserva.crear', 'estancia.checkin', 'estancia.checkout', 'caja.abrir', 'caja.cerrar', 'habitacion.gestionar', 'comprobante.emitir'],
    });
    const res = await http().post('/api/auth/login').send({ username: u.username, password: u.password });
    cookie = encabezadoCookies(cookiesDe(res));
    sucursalId = res.body.sucursalId as number;

    const usados = new Set((await prisma.piso.findMany({ where: { sucursal_id: sucursalId } })).map((p) => p.numero));
    let numero = 60;
    while (usados.has(numero)) numero++;
    const doble = await prisma.tipo_habitacion.findFirstOrThrow({ where: { nombre: 'Doble' } });
    const piso = await post('/hospedaje/plano/pisos', { numero, nombre: `Piso ${numero}`, habitaciones: 3, tipoHabitacionId: doble.id });
    expect(piso.status).toBe(201);
    habs = await prisma.habitacion.findMany({ where: { piso_id: piso.body.id as number }, orderBy: { numero: 'asc' }, select: { id: true, numero: true } });
    canalId = (await prisma.canal_venta.findFirstOrThrow({ where: { nombre: 'Recepción' } })).id;
    turno24 = (await prisma.turno.findFirstOrThrow({ where: { duracion_horas: 24 } })).id;
    turno6 = (await prisma.turno.findFirstOrThrow({ where: { duracion_horas: 6 } })).id;
    for (const m of (await get('/caja/metodos-pago')).body as Array<{ id: number; codigo: string }>) metodo[m.codigo] = m.id;

    // Caja abierta para la sucursal (otra prueba pudo dejarla abierta)
    const abrir = await post('/caja/abrir', { monto: 100 });
    expect([200, 409]).toContain(abrir.status);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('familia en dos habitaciones: reserva con adelanto, check-in con acompañantes, consumos y check-out con boleta y vuelto', async () => {
    const titular = await cliente('DNI', doc(), { nombres: 'Rosa', apellidos: 'Familia Prueba' });
    const hijo = await cliente('DNI', doc(), { nombres: 'Luis', apellidos: 'Familia Prueba' });
    const abuela = await cliente('DNI', doc(), { nombres: 'Carmen', apellidos: 'Familia Prueba' });

    const sinCaja = await post('/reservas', { clienteId: titular, canalId, turnoId: turno24, llegada: hoy, cantidad: 1, habitaciones: [{ habitacionId: habs[0].id, adultos: 2 }], adelanto: 50 });
    expect(sinCaja.status).toBe(400); // falta el método del adelanto

    const r = await post('/reservas', {
      clienteId: titular, canalId, turnoId: turno24, llegada: hoy, cantidad: 1,
      habitaciones: [{ habitacionId: habs[0].id, adultos: 2 }, { habitacionId: habs[1].id, adultos: 1 }],
      adelanto: 50, metodoPagoId: metodo.YAPE,
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ estado: 'CONFIRMADA', total: '220.00', adelanto: '50.00', comision: { porcentaje: '0.00' } });
    expect(r.body.habitaciones).toHaveLength(2);
    expect(await prisma.caja_movimiento.count({ where: { reserva_id: BigInt(r.body.id as number), concepto_movimiento: { codigo: 'ADELANTO_RESERVA' } } })).toBe(1);

    const ci = await post(`/reservas/${r.body.id}/checkin`, {
      huespedes: [{ habitacionId: habs[0].id, acompanantes: [hijo] }, { habitacionId: habs[1].id, titularId: abuela }],
    });
    expect(ci.status).toBe(200);
    expect(await estado(habs[0].id)).toBe('OCUPADA');
    expect(await estado(habs[1].id)).toBe('OCUPADA');

    const e1 = (await get(`/estancias/habitacion/${habs[0].id}`)).body;
    expect(e1.huespedes.map((h: { nombre: string; titular: boolean }) => [h.nombre, h.titular])).toEqual([['Rosa Familia Prueba', true], ['Luis Familia Prueba', false]]);
    const e2 = (await get(`/estancias/habitacion/${habs[1].id}`)).body;
    expect(e2.huespedes[0].nombre).toBe('Carmen Familia Prueba');

    const agua = await prisma.producto.findFirstOrThrow({ where: { codigo: 'AGUA625' } });
    expect((await post(`/estancias/${e2.id}/cargos`, { productoId: agua.id, cantidad: 2 })).status).toBe(200);
    const extra = await post(`/estancias/${e1.id}/cargos`, { descripcion: 'Hora extra de salida', cantidad: 1, precio: 20 });
    expect(extra.status).toBe(200);
    expect(extra.body.cuenta).toMatchObject({ total: '246.00', adelanto: '50.00', saldo: '196.00' });
    expect(extra.body.grupo).toHaveLength(2);

    const corto = await post(`/estancias/${e1.id}/checkout`, { tipoComprobante: 'BOLETA', pagos: [{ metodoPagoId: metodo.EFECTIVO, monto: 150 }] });
    expect(corto.status).toBe(400);
    expect(corto.body.message).toBe('Falta cobrar S/ 46.00');
    const factura = await post(`/estancias/${e1.id}/checkout`, { tipoComprobante: 'FACTURA', pagos: [{ metodoPagoId: metodo.EFECTIVO, monto: 196 }] });
    expect(factura.status).toBe(400);

    const co = await post(`/estancias/${e1.id}/checkout`, { tipoComprobante: 'BOLETA', pagos: [{ metodoPagoId: metodo.EFECTIVO, monto: 200 }] });
    expect(co.status).toBe(200);
    expect(co.body).toMatchObject({ total: '246.00', vuelto: '4.00' });
    expect(co.body.comprobante).toMatch(/^B\d{3}-\d{8}$/);
    expect(await estado(habs[0].id)).toBe('LIMPIEZA');
    expect(await estado(habs[1].id)).toBe('LIMPIEZA');
    expect((await prisma.reserva.findUniqueOrThrow({ where: { id: BigInt(r.body.id as number) } })).estado).toBe('FINALIZADA');

    const comp = (await get(`/comprobantes/${co.body.comprobanteId}`)).body;
    expect(comp.lineas).toHaveLength(4);
    expect(comp).toMatchObject({ tipo: 'BOLETA', total: '246.00', estadoSunat: 'PENDIENTE', letras: 'DOSCIENTOS CUARENTA Y SEIS CON 00/100 SOLES' });
    expect(Number(comp.gravada) + Number(comp.igv)).toBeCloseTo(246, 2);
    expect(comp.pagos.map((p: { monto: string }) => p.monto).sort()).toEqual(['196.00', '50.00']);
    const venta = await prisma.caja_movimiento.findMany({ where: { comprobante_pago_id: BigInt(co.body.comprobanteId as number) } });
    expect(venta.map((v) => v.monto.toFixed(2))).toEqual(['196.00']);
    expect(await prisma.auditoria.count({ where: { accion: 'estancia.checkout', registro_id: BigInt(co.body.comprobanteId as number) } })).toBe(1);
  });

  it('huésped sin reserva por 6 horas: check-in directo y nota interna pagada con Yape', async () => {
    const quien = await cliente('DNI', doc(), { nombres: 'Pedro', apellidos: 'Directo' });
    const ci = await post('/estancias', { habitacionId: habs[2].id, clienteId: quien, canalId, turnoId: turno6, cantidad: 1 });
    expect(ci.status).toBe(201);
    expect(await estado(habs[2].id)).toBe('OCUPADA');
    expect(Date.parse(ci.body.salidaPrevista) - Date.parse(ci.body.checkin)).toBe(6 * 3_600_000);
    const saldo = ci.body.cuenta.saldo as string;
    const vuelto = await post(`/estancias/${ci.body.id}/checkout`, { tipoComprobante: 'INTERNO', pagos: [{ metodoPagoId: metodo.YAPE, monto: Number(saldo) + 5 }] });
    expect(vuelto.status).toBe(400); // con Yape no hay vuelto
    const co = await post(`/estancias/${ci.body.id}/checkout`, { tipoComprobante: 'INTERNO', pagos: [{ metodoPagoId: metodo.YAPE, monto: Number(saldo), referencia: 'Op. 123456' }] });
    expect(co.status).toBe(200);
    expect(co.body.comprobante).toMatch(/^I\d{3}-/);
    expect((await get(`/comprobantes/${co.body.comprobanteId}`)).body.estadoSunat).toBe('NO_APLICA');
    expect((await post(`/estancias/${ci.body.id}/cargos`, { descripcion: 'tarde', cantidad: 1, precio: 1 })).status).toBe(409);
  });

  it('cierre de caja: el sistema calcula el efectivo esperado y la diferencia con lo contado', async () => {
    const caja = (await get('/caja')).body;
    expect(caja.sesion).not.toBeNull();
    const gasto = await post('/caja/movimientos', { concepto: 'GASTO', monto: 10, descripcion: 'Útiles de limpieza' });
    expect(gasto.status).toBe(200);
    const esperado = Number(gasto.body.efectivoEsperado);
    const cierre = await post('/caja/cerrar', { montoDeclarado: esperado - 1 });
    expect(cierre.status).toBe(200);
    expect(cierre.body).toMatchObject({ esperado: esperado.toFixed(2), diferencia: '-1.00' });
    expect((await get('/caja')).body.sesion).toBeNull();
    expect((await post('/estancias', {})).status).toBe(400);
  });
});
