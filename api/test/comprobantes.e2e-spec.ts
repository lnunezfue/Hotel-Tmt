import { randomBytes } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { fechaLima } from '../src/modules/reservas/domain/reserva';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies } from './utilidades';

/** Spec 2026-11-25 (S-07): series, elección por usuario, descuento global, boleta identificada, correlativo y estructura. */
describe('Comprobantes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let usuarioId: number;
  let sucursalId: number;
  let habs: Array<{ id: number; numero: string }>;
  let canalId: number;
  let turno24: number;
  const metodo: Record<string, number> = {};
  const hoy = fechaLima(new Date());
  /** Series creadas aquí: se desactivan y se liberan al final para no alterar las demás pruebas. */
  const creadas: number[] = [];
  let siguiente = 0;

  const http = () => request(app.getHttpServer());
  const post = (ruta: string, body: unknown = {}, c = cookie) => http().post(`/api${ruta}`).set('Cookie', c).send(body as object);
  const get = (ruta: string, c = cookie) => http().get(`/api${ruta}`).set('Cookie', c);
  const hab = () => habs[siguiente++];
  /** Serie de prueba que aún no existe: prefijo + Z + dos letras (ordena después de B001/I001, las del seed). */
  async function serieNueva(prefijo: string): Promise<string> {
    for (;;) {
      const [a, b] = randomBytes(2);
      const s = `${prefijo}Z${String.fromCharCode(65 + (a % 26))}${String.fromCharCode(65 + (b % 26))}`;
      if (!(await prisma.serie.findFirst({ where: { sucursal_id: sucursalId, serie: s } }))) return s;
    }
  }

  const PERMISOS = ['reserva.ver', 'reserva.crear', 'estancia.checkin', 'estancia.checkout', 'caja.abrir', 'caja.cerrar', 'habitacion.gestionar', 'config.empresa', 'descuento.aplicar', 'cliente.gestionar'];

  async function login(permisos: string[]) {
    const u = await crearUsuarioPrueba(prisma, { permisos });
    const res = await http().post('/api/auth/login').send({ username: u.username, password: u.password });
    expect(res.status).toBe(200);
    return { cookie: encabezadoCookies(cookiesDe(res)), id: u.id };
  }

  async function persona(): Promise<number> {
    const tipos = (await get('/clientes/tipos-documento')).body as Array<{ id: number; abreviatura: string }>;
    const numero = String(10_000_000 + Math.floor(Math.random() * 89_999_999)).slice(0, 8);
    const res = await post('/clientes', { tipoDocumentoId: tipos.find((t) => t.abreviatura === 'DNI')!.id, numeroDocumento: numero, nombres: 'Cliente', apellidos: `Comprobante ${numero.slice(-3)}` });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function estadia(cantidad = 1) {
    const e = await post('/estancias', { habitacionId: hab().id, clienteId: await persona(), canalId, turnoId: turno24, cantidad, procedencia: 'Lima, Perú' });
    expect(e.status).toBe(201);
    return e.body as { id: number; cuenta: { total: string; saldo: string } };
  }

  async function crearSerie(tipo: string, serie: string, extra: Record<string, unknown> = {}) {
    const r = await post('/facturacion/series', { tipo, serie, ...extra });
    if (r.status === 201) creadas.push(r.body.id as number);
    return r;
  }

  beforeAll(async () => {
    ({ app, prisma } = await crearApp());
    ({ cookie, id: usuarioId } = await login(PERMISOS));
    sucursalId = (await get('/auth/me')).body.sucursalId as number;
    const usados = new Set((await prisma.piso.findMany({ where: { sucursal_id: sucursalId } })).map((p) => p.numero));
    let numero = 99;
    while (usados.has(numero)) numero--;
    const doble = await prisma.tipo_habitacion.findFirstOrThrow({ where: { nombre: 'Doble' } });
    const piso = await post('/hospedaje/plano/pisos', { numero, nombre: `Piso ${numero}`, habitaciones: 12, tipoHabitacionId: doble.id });
    expect(piso.status).toBe(201);
    habs = await prisma.habitacion.findMany({ where: { piso_id: piso.body.id as number }, orderBy: { numero: 'asc' }, select: { id: true, numero: true } });
    canalId = (await prisma.canal_venta.findFirstOrThrow({ where: { nombre: 'Recepción' } })).id;
    turno24 = (await prisma.turno.findFirstOrThrow({ where: { duracion_horas: 24 } })).id;
    for (const m of (await get('/caja/metodos-pago')).body as Array<{ id: number; codigo: string }>) metodo[m.codigo] = m.id;
    expect([200, 201, 409]).toContain((await post('/caja/abrir', { monto: 100 })).status);
  });

  afterAll(async () => {
    if (prisma && creadas.length) {
      await prisma.usuario_serie.deleteMany({ where: { serie_id: { in: creadas } } });
      await prisma.serie.updateMany({ where: { id: { in: creadas } }, data: { activo: false } });
    }
    if (prisma && habs) await prisma.estancia.updateMany({ where: { habitacion_id: { in: habs.map((h) => h.id) }, estado: 'ACTIVA' }, data: { estado: 'ANULADA' } });
    await app?.close();
  });

  describe('Series', () => {
    it('crea series con el prefijo de SUNAT y no las repite', async () => {
      const s = await serieNueva('B');
      const r = await crearSerie('BOLETA', s.toLowerCase(), { correlativoInicial: 1500 });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ tipo: 'BOLETA', serie: s, ultimoNumero: 1500, siguiente: `${s}-00001501`, activo: true, usuarios: [] });
      expect((await crearSerie('BOLETA', s)).status).toBe(409);
      expect((await crearSerie('BOLETA', 'F123')).status).toBe(400);
      expect((await crearSerie('FACTURA', 'F1')).status).toBe(400);
      expect((await get('/facturacion/series')).body).toContainEqual(expect.objectContaining({ id: r.body.id }));
      expect(await prisma.auditoria.count({ where: { accion: 'serie.crear', registro_id: BigInt(r.body.id as number) } })).toBe(1);
    });

    it('no desactiva la última serie activa de un tipo de venta', async () => {
      const tipo = await prisma.tipo_comprobante.findUniqueOrThrow({ where: { codigo: 'INTERNO' } });
      const activas = await prisma.serie.findMany({ where: { sucursal_id: sucursalId, tipo_comprobante_id: tipo.id, activo: true }, orderBy: { id: 'asc' } });
      const [queda, ...resto] = activas;
      await prisma.serie.updateMany({ where: { id: { in: resto.map((x) => x.id) } }, data: { activo: false } });
      try {
        const r = await http().patch(`/api/facturacion/series/${queda.id}`).set('Cookie', cookie).send({ activo: false });
        expect(r.status).toBe(409);
      } finally {
        await prisma.serie.updateMany({ where: { id: { in: resto.map((x) => x.id) } }, data: { activo: true } });
      }
    });

    it('una serie asignada es exclusiva de sus usuarios; quien no tiene una propia usa una libre', async () => {
      const propia = await crearSerie('BOLETA', await serieNueva('B'));
      const asignada = await http().put(`/api/facturacion/series/${propia.body.id}/usuarios`).set('Cookie', cookie).send({ usuarioIds: [usuarioId] });
      expect(asignada.status).toBe(200);
      expect(asignada.body.usuarios.map((u: { id: number }) => u.id)).toEqual([usuarioId]);

      expect((await get('/facturacion/series/para-emitir?tipo=BOLETA')).body.id).toBe(propia.body.id);
      const otro = await login(['estancia.checkout']);
      const libre = await get('/facturacion/series/para-emitir?tipo=BOLETA', otro.cookie);
      expect(libre.status).toBe(200);
      expect(libre.body.id).not.toBe(propia.body.id);
      expect((await get(`/facturacion/series/para-emitir?tipo=BOLETA&serieId=${propia.body.id}`, otro.cookie)).status).toBe(409);

      // El check-out del usuario sale con su serie
      const e = await estadia();
      const co = await post(`/estancias/${e.id}/checkout`, { tipoComprobante: 'BOLETA', pagos: [{ metodoPagoId: metodo.EFECTIVO, monto: Number(e.cuenta.saldo) }] });
      expect(co.status).toBe(200);
      expect(co.body.comprobante).toMatch(new RegExp(`^${propia.body.serie}-\\d{8}$`));

      // Un usuario sin acceso a la sucursal no se asigna
      const ajeno = await crearUsuarioPrueba(prisma, { permisos: ['estancia.checkout'], sucursales: 'ninguna' });
      expect((await http().put(`/api/facturacion/series/${propia.body.id}/usuarios`).set('Cookie', cookie).send({ usuarioIds: [ajeno.id] })).status).toBe(400);
      await http().put(`/api/facturacion/series/${propia.body.id}/usuarios`).set('Cookie', cookie).send({ usuarioIds: [] });
    });

    it('sin el permiso config.empresa no administra series', async () => {
      const otro = await login(['estancia.checkout']);
      expect((await get('/facturacion/series', otro.cookie)).status).toBe(403);
      expect((await post('/facturacion/series', { tipo: 'BOLETA', serie: 'B999' }, otro.cookie)).status).toBe(403);
    });
  });

  describe('Descuento global', () => {
    it('resta el descuento del total sin tocar las líneas y lo deja en la estructura', async () => {
      const e = await estadia();
      const total = Number(e.cuenta.total);
      const co = await post(`/estancias/${e.id}/checkout`, {
        tipoComprobante: 'BOLETA',
        descuento: { tipo: 'MONTO', valor: 10, motivo: 'Cliente frecuente' },
        pagos: [{ metodoPagoId: metodo.EFECTIVO, monto: total - 10 }],
      });
      expect(co.status).toBe(200);
      expect(co.body).toMatchObject({ total: (total - 10).toFixed(2), descuento: '10.00' });

      const comp = (await get(`/comprobantes/${co.body.comprobanteId}`)).body;
      expect(comp).toMatchObject({ descuento: '10.00', descuentoMotivo: 'Cliente frecuente', total: (total - 10).toFixed(2) });
      expect(comp.lineas[0].total).toBe(total.toFixed(2));

      const est = await get(`/comprobantes/${co.body.comprobanteId}/estructura`);
      expect(est.status).toBe(200);
      expect(est.body.totales).toMatchObject({ descuentoGlobal: 8.47, total: total - 10 });
      expect(est.body.claveIdempotencia).toMatch(/^\d{11}-03-B/);
    });

    it('acepta porcentaje y exige el permiso descuento.aplicar', async () => {
      const e = await estadia();
      const sinPermiso = await login(['estancia.checkin', 'estancia.checkout', 'caja.abrir']);
      const prohibido = await post(`/estancias/${e.id}/checkout`, { tipoComprobante: 'INTERNO', descuento: { tipo: 'PORCENTAJE', valor: 10, motivo: 'Cortesía' }, pagos: [{ metodoPagoId: metodo.EFECTIVO, monto: 999 }] }, sinPermiso.cookie);
      expect(prohibido.status).toBe(403);
      const total = Number(e.cuenta.total);
      const co = await post(`/estancias/${e.id}/checkout`, { tipoComprobante: 'INTERNO', descuento: { tipo: 'PORCENTAJE', valor: 10, motivo: 'Convenio con la empresa' }, pagos: [{ metodoPagoId: metodo.EFECTIVO, monto: total }] });
      expect(co.status).toBe(200);
      expect(co.body.descuento).toBe((total * 0.1).toFixed(2));
      expect(Number(co.body.vuelto)).toBeCloseTo(total * 0.1, 2);
    });

    it('no deja el total por debajo del adelanto ya cobrado', async () => {
      const h = hab();
      const r = await post('/reservas', { clienteId: await persona(), canalId, turnoId: turno24, llegada: hoy, cantidad: 1, habitaciones: [{ habitacionId: h.id, adultos: 1 }], adelanto: 100, metodoPagoId: metodo.EFECTIVO });
      expect(r.status).toBe(201);
      expect((await post(`/reservas/${r.body.id}/checkin`, { procedencia: 'Cusco' })).status).toBe(200);
      const e = (await get(`/estancias/habitacion/${h.id}`)).body as { id: number; cuenta: { total: string; saldo: string } };
      const malo = await post(`/estancias/${e.id}/checkout`, { tipoComprobante: 'BOLETA', descuento: { tipo: 'MONTO', valor: Number(e.cuenta.saldo) + 1, motivo: 'Descuento excesivo' }, pagos: [] });
      expect(malo.status).toBe(400);
      expect(malo.body.message).toContain('adelanto');
    });
  });

  it('una boleta de más de S/ 700 exige identificar al comprador', async () => {
    const e = await estadia(8);
    expect(Number(e.cuenta.total)).toBeGreaterThan(700);
    const sinDoc = await prisma.tipo_documento_identidad.findUniqueOrThrow({ where: { codigo_sunat: '0' } });
    const empresa = await prisma.empresa.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const anonimo = await prisma.cliente.create({ data: { empresa_id: empresa.id, tipo_documento_id: sinDoc.id, numero_documento: `SD${randomBytes(3).toString('hex').toUpperCase()}`, nombres: 'Cliente', apellidos: 'Varios' } });
    const r = await post(`/estancias/${e.id}/checkout`, { tipoComprobante: 'BOLETA', clienteId: Number(anonimo.id), pagos: [{ metodoPagoId: metodo.EFECTIVO, monto: Number(e.cuenta.saldo) }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('S/ 700');
  });

  describe('Correlativo transaccional (RF-FAC-07)', () => {
    it('20 reservas de número simultáneas en la misma serie: sin saltos ni duplicados', async () => {
      const s = await crearSerie('INTERNO', await serieNueva('I'));
      const numeros = await Promise.all(
        Array.from({ length: 20 }, () =>
          prisma.$transaction(async (tx) => {
            await tx.$executeRaw`CALL sp_siguiente_correlativo(${s.body.id as number}, @numero)`;
            const [{ numero }] = await tx.$queryRaw<Array<{ numero: number | bigint }>>`SELECT @numero AS numero`;
            return Number(numero);
          }),
        ),
      );
      expect([...numeros].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });

    it('cuatro check-out simultáneos con la misma serie salen con números consecutivos', async () => {
      const propia = await crearSerie('INTERNO', await serieNueva('I'));
      await http().put(`/api/facturacion/series/${propia.body.id}/usuarios`).set('Cookie', cookie).send({ usuarioIds: [usuarioId] });
      const estadias = [];
      for (let i = 0; i < 4; i++) estadias.push(await estadia());
      const res = await Promise.all(
        estadias.map((e) => post(`/estancias/${e.id}/checkout`, { tipoComprobante: 'INTERNO', pagos: [{ metodoPagoId: metodo.EFECTIVO, monto: Number(e.cuenta.saldo) }] })),
      );
      expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      const nums = res.map((r) => Number((r.body.comprobante as string).split('-')[1])).sort((a, b) => a - b);
      expect(nums).toEqual([1, 2, 3, 4]);
      expect(res.every((r) => (r.body.comprobante as string).startsWith(propia.body.serie as string))).toBe(true);
    });
  });
});
