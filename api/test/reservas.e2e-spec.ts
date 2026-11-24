import { randomBytes, randomInt } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookiesDe, crearApp, crearUsuarioPrueba, encabezadoCookies } from './utilidades';

const HORA = 3_600_000;

/** Spec 2026-11-24 (S-06): clientes, reservas, check-in, extensión y check-out. */
describe('Ciclo de hospedaje (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cookie: string;
  let sucursalId: number;
  let pisoId: number;
  let canalRecepcion: { id: number };
  let canalBooking: { id: number; comision_porcentaje: { toFixed(n: number): string } };
  let turno24: number;
  let turno3: number;
  /** Habitaciones Doble (2 personas) creadas para esta prueba; se desactivan al final. */
  const habitaciones: number[] = [];

  const http = () => request(app.getHttpServer());
  const get = (ruta: string) => http().get(`/api/hospedaje${ruta}`).set('Cookie', cookie);
  const post = (ruta: string, cuerpo: object = {}, c = cookie) => http().post(`/api/hospedaje${ruta}`).set('Cookie', c).send(cuerpo);

  async function login(permisos: string[]): Promise<string> {
    const u = await crearUsuarioPrueba(prisma, { permisos });
    const res = await http().post('/api/auth/login').send({ username: u.username, password: u.password });
    expect(res.status).toBe(200);
    return encabezadoCookies(cookiesDe(res));
  }

  async function nuevaHabitacion(): Promise<number> {
    const doble = await prisma.tipo_habitacion.findFirstOrThrow({ where: { nombre: 'Doble' } });
    const libre = await prisma.estado_habitacion.findUniqueOrThrow({ where: { codigo: 'DESOCUPADA' } });
    const h = await prisma.habitacion.create({
      data: { sucursal_id: sucursalId, piso_id: pisoId, tipo_habitacion_id: doble.id, estado_habitacion_id: libre.id, numero: `E${randomBytes(3).toString('hex')}` },
    });
    habitaciones.push(h.id);
    return h.id;
  }

  async function nuevoCliente(extra: Record<string, unknown> = {}) {
    const res = await post('/clientes', { tipoDocumento: '1', numeroDocumento: String(randomInt(10_000_000, 99_999_999)), nombres: 'Huésped', apellidos: `E2E ${randomBytes(2).toString('hex')}`, ...extra });
    expect(res.status).toBe(201);
    return res.body as { id: number; numeroDocumento: string };
  }

  function reservar(d: { habitacionIds: number[]; clienteId: number; entrada?: Date; cantidadTurnos?: number; canalId?: number; turnoId?: number; adultos?: number }, c = cookie) {
    return post(
      '/reservas',
      {
        canalId: d.canalId ?? canalRecepcion.id,
        turnoId: d.turnoId ?? turno24,
        cantidadTurnos: d.cantidadTurnos ?? 1,
        adultos: d.adultos ?? 1,
        entrada: (d.entrada ?? new Date(Date.now() + 2 * 24 * HORA)).toISOString(),
        habitacionIds: d.habitacionIds,
        clienteId: d.clienteId,
      },
      c,
    );
  }

  const libro = { procedencia: 'Arequipa, Perú', motivoViaje: 'Turismo' };

  async function walkin(habitacionId: number, titularId: number, extra: Record<string, unknown> = {}) {
    return post('/estancias', { habitacionId, canalId: canalRecepcion.id, turnoId: turno24, cantidadTurnos: 1, titularId, ...libro, ...extra });
  }

  const estadoDe = async (id: number) => (await prisma.habitacion.findUniqueOrThrow({ where: { id }, include: { estado_habitacion: true } })).estado_habitacion.codigo;

  beforeAll(async () => {
    ({ app, prisma } = await crearApp());
    cookie = await login(['cliente.gestionar', 'reserva.crear', 'reserva.cancelar', 'estancia.checkin', 'estancia.checkout', 'habitacion.cambiar_estado']);
    const yo = await http().get('/api/auth/me').set('Cookie', cookie);
    sucursalId = yo.body.sucursalId as number;
    const usados = new Set((await prisma.piso.findMany({ where: { sucursal_id: sucursalId }, select: { numero: true } })).map((p) => p.numero));
    let numero = 199;
    while (usados.has(numero)) numero--;
    pisoId = (await prisma.piso.create({ data: { sucursal_id: sucursalId, numero, nombre: 'Piso e2e reservas' } })).id;
    canalRecepcion = await prisma.canal_venta.findFirstOrThrow({ where: { nombre: 'Recepción' } });
    canalBooking = await prisma.canal_venta.findFirstOrThrow({ where: { nombre: 'Booking' } });
    turno24 = (await prisma.turno.findFirstOrThrow({ where: { duracion_horas: 24 } })).id;
    turno3 = (await prisma.turno.findFirstOrThrow({ where: { duracion_horas: 3 } })).id;
  });

  afterAll(async () => {
    if (prisma) {
      // Cierra lo que haya quedado abierto y retira las habitaciones de prueba del tablero.
      await prisma.estancia.updateMany({ where: { habitacion_id: { in: habitaciones }, estado: 'ACTIVA' }, data: { estado: 'ANULADA' } });
      await prisma.reserva.updateMany({ where: { reserva_habitacion: { some: { habitacion_id: { in: habitaciones } } }, estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'] } }, data: { estado: 'CANCELADA' } });
      await prisma.habitacion.updateMany({ where: { id: { in: habitaciones } }, data: { activo: false } });
      if (pisoId) await prisma.piso.update({ where: { id: pisoId }, data: { activo: false } });
    }
    await app?.close();
  });

  describe('Clientes', () => {
    it('crea un cliente, lo encuentra por documento y no repite el documento', async () => {
      const c = await nuevoCliente({ email: ' Ana@Hotel.PE ' });
      const busqueda = await get(`/clientes?q=${c.numeroDocumento.slice(0, 6)}`);
      expect(busqueda.status).toBe(200);
      expect(busqueda.body).toContainEqual(expect.objectContaining({ id: c.id, email: 'ana@hotel.pe', esPersona: true }));
      const repetido = await post('/clientes', { tipoDocumento: '1', numeroDocumento: c.numeroDocumento, nombres: 'Otro', apellidos: 'Cliente' });
      expect(repetido.status).toBe(409);
      expect(await prisma.auditoria.count({ where: { accion: 'cliente.crear', registro_id: BigInt(c.id) } })).toBe(1);
    });

    it('valida el documento según su tipo', async () => {
      expect((await post('/clientes', { tipoDocumento: '1', numeroDocumento: '1234', nombres: 'A', apellidos: 'B' })).status).toBe(400);
      expect((await post('/clientes', { tipoDocumento: '6', numeroDocumento: '20100047219', razonSocial: 'Empresa' })).status).toBe(400);
    });
  });

  describe('Reservas', () => {
    it('reserva dos habitaciones con precio y comisión congelados', async () => {
      const [a, b] = [await nuevaHabitacion(), await nuevaHabitacion()];
      const titular = await nuevoCliente();
      const res = await reservar({ habitacionIds: [a, b], clienteId: titular.id, canalId: canalBooking.id, cantidadTurnos: 2, adultos: 3 });
      expect(res.status).toBe(201);
      expect(res.body.codigo).toMatch(/^R-\d{4}-\d{6}$/);
      expect(res.body.estado).toBe('PENDIENTE');
      expect(res.body.comisionPorcentaje).toBe(canalBooking.comision_porcentaje.toFixed(2));
      expect(res.body.habitaciones).toHaveLength(2);
      const precio = Number(res.body.habitaciones[0].precioUnitario);
      expect(precio).toBeGreaterThan(0);
      expect(Number(res.body.montoTotal)).toBeCloseTo(precio * 2 * 2, 2);
      expect(await prisma.auditoria.count({ where: { accion: 'reserva.crear', registro_id: BigInt(res.body.id as number) } })).toBe(1);

      // Ya no aparecen como disponibles en ese horario
      const q = new URLSearchParams({ entrada: res.body.entrada as string, turnoId: String(turno24), cantidad: '1', canalId: String(canalBooking.id) });
      const disp = await get(`/reservas/disponibles?${q}`);
      expect(disp.status).toBe(200);
      const ids = (disp.body.habitaciones as Array<{ id: number }>).map((h) => h.id);
      expect(ids).not.toContain(a);
      expect(ids).not.toContain(b);

      // El documento de un cliente con reservas ya no se cambia
      const cambio = await http().patch(`/api/hospedaje/clientes/${titular.id}`).set('Cookie', cookie).send({ numeroDocumento: String(randomInt(10_000_000, 99_999_999)) });
      expect(cambio.status).toBe(409);
    });

    it('impide reservar una habitación ya reservada en ese horario', async () => {
      const h = await nuevaHabitacion();
      const titular = await nuevoCliente();
      const entrada = new Date(Date.now() + 3 * 24 * HORA);
      expect((await reservar({ habitacionIds: [h], clienteId: titular.id, entrada, cantidadTurnos: 2 })).status).toBe(201);
      const choque = await reservar({ habitacionIds: [h], clienteId: titular.id, entrada: new Date(entrada.getTime() + 24 * HORA) });
      expect(choque.status).toBe(409);
      expect(choque.body.message).toContain('ya está reservada');
      // Justo al terminar la anterior sí se puede
      expect((await reservar({ habitacionIds: [h], clienteId: titular.id, entrada: new Date(entrada.getTime() + 48 * HORA) })).status).toBe(201);
    });

    it('de dos reservas simultáneas de la misma habitación solo una gana', async () => {
      const h = await nuevaHabitacion();
      const titular = await nuevoCliente();
      const entrada = new Date(Date.now() + 5 * 24 * HORA);
      const [r1, r2] = await Promise.all([reservar({ habitacionIds: [h], clienteId: titular.id, entrada }), reservar({ habitacionIds: [h], clienteId: titular.id, entrada })]);
      expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    });

    it('confirma, anula con motivo y no marca no-show antes de la hora', async () => {
      const h = await nuevaHabitacion();
      const titular = await nuevoCliente();
      const r = await reservar({ habitacionIds: [h], clienteId: titular.id });
      const id = r.body.id as number;
      expect((await post(`/reservas/${id}/confirmar`)).body.estado).toBe('CONFIRMADA');
      expect((await post(`/reservas/${id}/confirmar`)).status).toBe(409);
      expect((await post(`/reservas/${id}/no-show`, { motivo: 'No llegó el cliente' })).status).toBe(409);
      expect((await post(`/reservas/${id}/anular`, { motivo: 'no' })).status).toBe(400);
      const anulada = await post(`/reservas/${id}/anular`, { motivo: 'El cliente canceló por teléfono' });
      expect(anulada.status).toBe(200);
      expect(anulada.body).toMatchObject({ estado: 'CANCELADA', motivoCancelacion: 'El cliente canceló por teléfono' });
      expect(anulada.body.canceladaPor).toMatch(/^e2e_/);
      // La habitación queda libre otra vez
      expect((await reservar({ habitacionIds: [h], clienteId: titular.id })).status).toBe(201);
    });

    it('no acepta más personas que la capacidad ni fechas pasadas', async () => {
      const h = await nuevaHabitacion();
      const titular = await nuevoCliente();
      expect((await reservar({ habitacionIds: [h], clienteId: titular.id, adultos: 3 })).status).toBe(400);
      expect((await reservar({ habitacionIds: [h], clienteId: titular.id, entrada: new Date(Date.now() - 2 * 24 * HORA) })).status).toBe(400);
    });

    it('sin el permiso reserva.crear no reserva, pero con estancia.checkin ve el calendario', async () => {
      const otro = await login(['estancia.checkin']);
      const h = await nuevaHabitacion();
      const titular = await nuevoCliente();
      expect((await reservar({ habitacionIds: [h], clienteId: titular.id }, otro)).status).toBe(403);
      expect((await http().get('/api/hospedaje/reservas/calendario').set('Cookie', otro)).status).toBe(200);
    });
  });

  describe('Check-in, extensión y check-out', () => {
    it('hace el ciclo completo desde una reserva de hoy', async () => {
      const h = await nuevaHabitacion();
      const titular = await nuevoCliente();
      const acompanante = await nuevoCliente();
      const r = await reservar({ habitacionIds: [h], clienteId: titular.id, entrada: new Date(Date.now() + 60_000), canalId: canalBooking.id, cantidadTurnos: 2 });
      expect(r.status).toBe(201);

      // El tablero muestra la llegada de hoy
      const tablero = await get('/tablero');
      const tarjeta = (tablero.body.pisos as Array<{ habitaciones: Array<{ id: number; llegada: { codigo: string } | null }> }>).flatMap((p) => p.habitaciones).find((x) => x.id === h);
      expect(tarjeta?.llegada?.codigo).toBe(r.body.codigo);

      const rh = r.body.habitaciones[0].id as number;
      const ci = await post('/estancias', { reservaHabitacionId: rh, titularId: titular.id, acompanantes: [acompanante.id], ...libro });
      expect(ci.status).toBe(201);
      expect(ci.body).toMatchObject({ estado: 'ACTIVA', cantidadTurnos: 2, comisionPorcentaje: canalBooking.comision_porcentaje.toFixed(2), reserva: { codigo: r.body.codigo } });
      expect(ci.body.huespedes).toHaveLength(2);
      expect(await estadoDe(h)).toBe('OCUPADA');
      expect((await get(`/reservas/${r.body.id}`)).body.estado).toBe('EN_CURSO');
      expect((await post('/estancias', { reservaHabitacionId: rh, titularId: titular.id, ...libro })).status).toBe(409);

      // Ya no se cambia a mano: se libera con el check-out
      const manual = await http().patch(`/api/hospedaje/habitaciones/${h}/estado`).set('Cookie', cookie).send({ estado: 'LIMPIEZA' });
      expect(manual.status).toBe(409);

      // Un huésped alojado no ingresa a otra habitación
      expect((await walkin(await nuevaHabitacion(), titular.id)).status).toBe(409);

      // Libro de huéspedes de hoy
      const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
      const libroHoy = await get(`/libro-huespedes?desde=${hoy}&hasta=${hoy}`);
      expect(libroHoy.status).toBe(200);
      expect((libroHoy.body as Array<{ estanciaId: number }>).filter((f) => f.estanciaId === ci.body.id)).toHaveLength(2);

      const salida = await post(`/estancias/${ci.body.id}/checkout`);
      expect(salida.status).toBe(200);
      expect(salida.body.liquidacion).toMatchObject({ contratados: 2, consumidos: 2, adicionales: 0 });
      expect(salida.body.estancia.estado).toBe('FINALIZADA');
      expect(await estadoDe(h)).toBe('LIMPIEZA');
      expect((await get(`/reservas/${r.body.id}`)).body.estado).toBe('FINALIZADA');
      expect(await prisma.auditoria.count({ where: { accion: { in: ['estancia.checkin', 'estancia.checkout'] }, registro_id: BigInt(ci.body.id as number) } })).toBe(2);

      // Salió antes: el rango que quedaba de la reserva se puede volver a reservar
      expect((await reservar({ habitacionIds: [h], clienteId: titular.id, entrada: new Date(Date.now() + 12 * HORA) })).status).toBe(201);
    });

    it('walk-in: exige una habitación lista, respeta la capacidad y no acepta a una empresa como huésped', async () => {
      const titular = await nuevoCliente();
      const [x, y] = [await nuevoCliente(), await nuevoCliente()];
      const sucia = await nuevaHabitacion();
      const limpieza = await prisma.estado_habitacion.findUniqueOrThrow({ where: { codigo: 'LIMPIEZA' } });
      await prisma.habitacion.update({ where: { id: sucia }, data: { estado_habitacion_id: limpieza.id } });
      expect((await walkin(sucia, titular.id)).status).toBe(409);

      const h = await nuevaHabitacion();
      expect((await walkin(h, titular.id, { acompanantes: [x.id, y.id] })).status).toBe(400);
      const empresa = await post('/clientes', { tipoDocumento: '6', numeroDocumento: '20100047218', razonSocial: 'Empresa e2e' });
      const empresaId = empresa.status === 201 ? (empresa.body.id as number) : (await get('/clientes?q=20100047218')).body[0].id;
      expect((await walkin(h, empresaId)).status).toBe(400);
      expect((await walkin(h, titular.id, { motivoViaje: 'Vacaciones' })).status).toBe(400);

      const ok = await walkin(h, titular.id, { turnoId: turno3, cantidadTurnos: 1 });
      expect(ok.status).toBe(201);
      expect(ok.body.reserva).toBeNull();
      expect(ok.body.turno.horas).toBe(3);
      await post(`/estancias/${ok.body.id}/checkout`);
    });

    it('extiende si la habitación está libre y no si choca con una reserva', async () => {
      const h = await nuevaHabitacion();
      const titular = await nuevoCliente();
      const e = await walkin(h, titular.id);
      expect(e.status).toBe(201);
      const salida = new Date(e.body.salidaPrevista as string);

      const ext = await post(`/estancias/${e.body.id}/extension`, { turnos: 1 });
      expect(ext.status).toBe(200);
      expect(ext.body.cantidadTurnos).toBe(2);
      expect(new Date(ext.body.salidaPrevista as string).getTime()).toBe(salida.getTime() + 24 * HORA);

      // Una reserva que empieza al minuto siguiente de terminar la estancia extendida (la entrada se guarda sin segundos)
      const otro = await nuevoCliente();
      expect((await reservar({ habitacionIds: [h], clienteId: otro.id, entrada: new Date(salida.getTime() + 24 * HORA + 60_000) })).status).toBe(201);
      const choque = await post(`/estancias/${e.body.id}/extension`, { turnos: 1 });
      expect(choque.status).toBe(409);
      expect((await post(`/estancias/${e.body.id}/extension`, { turnos: 0 })).status).toBe(400);
      await post(`/estancias/${e.body.id}/checkout`);
    });

    it('cobra un turno más si el huésped sale pasada la tolerancia', async () => {
      const h = await nuevaHabitacion();
      const titular = await nuevoCliente();
      const e = await walkin(h, titular.id);
      // Simula que ingresó hace 25 horas con un turno de 24
      const ingreso = new Date(Date.now() - 25 * HORA);
      await prisma.estancia.update({ where: { id: e.body.id as number }, data: { checkin_at: ingreso, checkout_previsto: new Date(ingreso.getTime() + 24 * HORA) } });

      const prev = await get(`/estancias/${e.body.id}/liquidacion`);
      expect(prev.body).toMatchObject({ contratados: 1, consumidos: 2, adicionales: 1 });
      const fin = await post(`/estancias/${e.body.id}/checkout`);
      expect(fin.status).toBe(200);
      expect(fin.body.estancia.cantidadTurnos).toBe(2);
      expect(Number(fin.body.estancia.montoHospedaje)).toBeCloseTo(Number(fin.body.estancia.precioUnitario) * 2, 2);
      expect((await post(`/estancias/${e.body.id}/checkout`)).status).toBe(409);
    });

    it('la habitación no se marca ocupada a mano', async () => {
      const h = await nuevaHabitacion();
      const res = await http().patch(`/api/hospedaje/habitaciones/${h}/estado`).set('Cookie', cookie).send({ estado: 'OCUPADA' });
      expect(res.status).toBe(409);
    });
  });
});
