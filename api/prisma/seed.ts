/**
 * Datos de EJEMPLO para desarrollo y demo. «Hotel Centro» sigue el plano y la operación del hotel real (2 niveles,
 * 14 habitaciones, estadías cortas con pago adelantado); clientes, precios y movimientos son inventados.
 * Los catálogos SUNAT ya los carga la migración inicial. Ejecutar: pnpm db:seed
 */
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import * as argon2 from 'argon2';
import 'dotenv/config';
import { distribucionInicial } from '../src/modules/hospedaje/domain/plano';
import { codigoReserva, fechaLima, rangoPorNoches } from '../src/modules/reservas/domain/reserva';
import { FRANJAS_SUGERIDAS, salidaNoche } from '../src/modules/hospedaje/domain/operacion';
import { desglosarIgv, montoEnLetras } from '../src/modules/estancias/domain/cobro';

const url = new URL(process.env.DATABASE_URL ?? '');
const prisma = new PrismaClient({
  adapter: new PrismaMariaDb({
    host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: url.pathname.slice(1), allowPublicKeyRetrieval: true,
  }),
});

const CLAVE_DEMO = 'Hotel2026!';
const h = (n: number) => n * 3_600_000;

async function main() {
  if (await prisma.empresa.findFirst()) {
    console.log('La base ya tiene datos de ejemplo; no se vuelve a cargar.');
    return;
  }

  // Permisos adicionales de esta etapa + rol de limpieza (actor del DT-001 §01)
  const extra = [
    { codigo: 'usuario.ver', modulo: 'CONFIG', descripcion: 'Ver usuarios y roles' },
    { codigo: 'habitacion.cambiar_estado', modulo: 'RESERVAS', descripcion: 'Cambiar el estado de una habitación' },
    { codigo: 'habitacion.gestionar', modulo: 'RESERVAS', descripcion: 'Crear y editar habitaciones, pisos y tipos' },
    { codigo: 'reserva.ver', modulo: 'RESERVAS', descripcion: 'Ver el calendario de reservas y la disponibilidad' },
  ];
  for (const p of extra) await prisma.permiso.upsert({ where: { codigo: p.codigo }, update: {}, create: p });
  await prisma.rol.upsert({ where: { nombre: 'LIMPIEZA' }, update: {}, create: { nombre: 'LIMPIEZA', descripcion: 'Solo cambia el estado de habitaciones' } });

  const permisos = await prisma.permiso.findMany();
  const pid = (c: string) => permisos.find((p) => p.codigo === c)!.id;
  const roles = await prisma.rol.findMany();
  const rid = (n: string) => roles.find((r) => r.nombre === n)!.id;
  const asignacion: Record<string, string[]> = {
    ADMINISTRADOR: permisos.map((p) => p.codigo),
    RECEPCIONISTA: ['reserva.ver', 'reserva.crear', 'reserva.cancelar', 'estancia.checkin', 'estancia.checkout', 'cliente.gestionar', 'comprobante.emitir', 'descuento.aplicar', 'caja.abrir', 'caja.cerrar', 'habitacion.cambiar_estado'],
    CAJERO: ['cliente.gestionar', 'comprobante.emitir', 'caja.abrir', 'caja.cerrar'],
    ALMACEN: ['compra.registrar', 'reporte.ver'],
    CONTADOR: ['reporte.ver', 'comprobante.anular'],
    LIMPIEZA: ['habitacion.cambiar_estado'],
  };
  await prisma.rol_permiso.deleteMany();
  await prisma.rol_permiso.createMany({
    data: Object.entries(asignacion).flatMap(([rol, cods]) => cods.map((c) => ({ rol_id: rid(rol), permiso_id: pid(c) }))),
  });

  const empresa = await prisma.empresa.create({
    data: { ruc: '20123456789', razon_social: 'HOTEL DEMO S.A.C.', nombre_comercial: 'Hotel Demo', direccion_fiscal: 'Av. Bolognesi 123, Tacna', ubigeo_codigo: '230101', sunat_entorno: 'BETA' },
  });
  const centro = await prisma.sucursal.create({ data: { empresa_id: empresa.id, codigo_establecimiento: '0000', nombre: 'Hotel Centro', tipo: 'HOTEL', direccion: 'Av. Bolognesi 123', ubigeo_codigo: '230101' } });
  const alto = await prisma.sucursal.create({ data: { empresa_id: empresa.id, codigo_establecimiento: '0001', nombre: 'Hostal Alto Tacna', tipo: 'HOSTAL', direccion: 'Calle Alto Lima 456', ubigeo_codigo: '230101' } });

  const hash = await argon2.hash(CLAVE_DEMO, { type: argon2.argon2id });
  const usuarios = [
    { username: 'admin', nombres: 'Ana', apellidos: 'Pérez Mamani', rol: 'ADMINISTRADOR', suc: [centro.id, alto.id] },
    { username: 'recepcion1', nombres: 'Luis', apellidos: 'Quispe Flores', rol: 'RECEPCIONISTA', suc: [centro.id] },
    { username: 'recepcion2', nombres: 'María', apellidos: 'Condori Ticona', rol: 'RECEPCIONISTA', suc: [alto.id] },
    { username: 'caja1', nombres: 'Jorge', apellidos: 'Ramos Vargas', rol: 'CAJERO', suc: [centro.id, alto.id] },
    { username: 'limpieza1', nombres: 'Rosa', apellidos: 'Huanca Choque', rol: 'LIMPIEZA', suc: [centro.id] },
  ];
  const creados: Record<string, number> = {};
  for (const u of usuarios) {
    const r = await prisma.usuario.create({
      data: {
        empresa_id: empresa.id, rol_id: rid(u.rol), username: u.username, password_hash: hash, nombres: u.nombres, apellidos: u.apellidos,
        email: `${u.username}@hoteldemo.pe`,
        usuario_sucursal: { create: u.suc.map((s, i) => ({ sucursal_id: s, es_principal: i === 0 })) },
      },
    });
    creados[u.username] = r.id;
  }

  const tipos = await Promise.all(
    ([['Simple', 1, 0], ['Doble', 2, 1], ['Matrimonial', 2, 1], ['Suite', 3, 2]] as const).map(([nombre, cap, ninos]) =>
      prisma.tipo_habitacion.create({ data: { empresa_id: empresa.id, nombre, capacidad_adultos: cap, capacidad_ninos: ninos } }),
    ),
  );
  const estados = await prisma.estado_habitacion.findMany();
  const eid = (c: string) => estados.find((e) => e.codigo === c)!.id;

  const canales = await Promise.all([
    prisma.canal_venta.create({ data: { empresa_id: empresa.id, nombre: 'Recepción', comision_porcentaje: 0 } }),
    prisma.canal_venta.create({ data: { empresa_id: empresa.id, nombre: 'Booking', comision_porcentaje: 15, es_ota: true } }),
    prisma.canal_venta.create({ data: { empresa_id: empresa.id, nombre: 'Teléfono', comision_porcentaje: 0 } }),
  ]);
  // El promedio de estadía del hotel de parejas es de 4 horas (información del cuartelero, 2026-11-26)
  if (!(await prisma.turno.findFirst({ where: { duracion_horas: 4 } }))) await prisma.turno.create({ data: { nombre: 'Turno 4 horas', duracion_horas: 4 } });
  const turnos = await prisma.turno.findMany();
  const turno = (horas: number) => turnos.find((t) => t.duracion_horas === horas)!;
  const pen = await prisma.moneda.findUniqueOrThrow({ where: { codigo_iso: 'PEN' } });

  // Tarifas de ejemplo: precio base por tipo (24 h) y factor por turno y canal
  const base = [70, 110, 120, 220];
  const factorTurno: Record<number, number> = { 24: 1, 12: 0.7, 6: 0.5, 4: 0.4, 3: 0.35 };
  for (const suc of [centro, alto]) {
    for (const [i, t] of tipos.entries()) {
      for (const tu of turnos) {
        for (const c of canales) {
          const precio = Math.round(base[i] * (factorTurno[tu.duracion_horas] ?? tu.duracion_horas / 24) * (c.nombre === 'Booking' ? 1.15 : 1) * (suc.id === alto.id ? 0.8 : 1));
          await prisma.tarifa.create({
            data: { sucursal_id: suc.id, tipo_habitacion_id: t.id, canal_venta_id: c.id, turno_id: tu.id, moneda_id: pen.id, precio, vigente_desde: new Date('2026-01-01') },
          });
        }
      }
    }
  }

  // Comodidades: la migración las crea para empresas existentes; esta empresa nace después.
  const catalogo: Array<[string, string, string]> = [
    ['AIRE', 'Aire acondicionado', 'aire'], ['WIFI', 'Internet wifi', 'wifi'], ['TV', 'Televisor', 'tv'], ['AGUA_CALIENTE', 'Agua caliente', 'ducha'],
    ['BANO_PRIVADO', 'Baño privado', 'bano'], ['FRIGOBAR', 'Frigobar', 'frigobar'], ['CAJA_FUERTE', 'Caja fuerte', 'caja_fuerte'],
    ['CALEFACCION', 'Calefacción', 'calefaccion'], ['BALCON', 'Balcón', 'balcon'], ['JACUZZI', 'Jacuzzi', 'jacuzzi'],
    ['ESCRITORIO', 'Escritorio de trabajo', 'escritorio'], ['ACCESIBLE', 'Accesible (silla de ruedas)', 'accesible'],
  ];
  const amen: Record<string, number> = {};
  for (const [i, [codigo, nombre, icono]] of catalogo.entries()) {
    const a = await prisma.amenidad.upsert({ where: { empresa_id_codigo: { empresa_id: empresa.id, codigo } }, update: {}, create: { empresa_id: empresa.id, codigo, nombre, icono, orden: i + 1 } });
    amen[codigo] = a.id;
  }
  const equipamiento = (tipo: string, numero: string): string[] => {
    const base = ['WIFI', 'TV', 'AGUA_CALIENTE', 'BANO_PRIVADO'];
    const extra: Record<string, string[]> = { Simple: [], Doble: ['AIRE'], Matrimonial: ['AIRE', 'FRIGOBAR'], Suite: ['AIRE', 'FRIGOBAR', 'CAJA_FUERTE', 'JACUZZI', 'ESCRITORIO', 'BALCON'] };
    const r = [...base, ...(extra[tipo] ?? [])];
    if (numero.endsWith('01') && !r.includes('BALCON')) r.push('BALCON');
    if (numero === '101') r.push('ACCESIBLE');
    return r;
  };

  const habs: Record<string, number> = {};
  const crearHabitacion = async (suc: number, pisoId: number, numero: string, tipo: (typeof tipos)[number], x: number, y: number, ancho = 3, alto = 2) => {
    const hab = await prisma.habitacion.create({
      data: {
        sucursal_id: suc, piso_id: pisoId, tipo_habitacion_id: tipo.id, estado_habitacion_id: eid('DESOCUPADA'), numero, plano_x: x, plano_y: y, plano_ancho: ancho, plano_alto: alto,
        habitacion_amenidad: { create: equipamiento(tipo.nombre, numero).map((c) => ({ amenidad_id: amen[c] })) },
      },
    });
    habs[`${suc}-${numero}`] = hab.id;
  };

  // Hotel Centro: el plano real de 2 niveles, girado para la pantalla (la calle queda a la izquierda).
  // 1er nivel: garaje, recepción y escalera a la calle; sala-comedor-cocineta; 5 dormitorios, SS.HH. y patio al fondo.
  // 2do nivel: 9 dormitorios a ambos lados del pasillo, SS.HH. y escalera. Todas matrimoniales menos una doble.
  const [matrimonial, doble] = [tipos[2], tipos[1]];
  type Elemento = { tipo: 'PASILLO' | 'ESCALERA' | 'RECEPCION' | 'AREA_COMUN' | 'BANO_COMUN'; etiqueta?: string; x: number; y: number; ancho: number; alto: number };
  const real: Array<{ numero: number; nombre: string; columnas: number; filas: number; elementos: Elemento[]; habitaciones: Array<[string, number, number]> }> = [
    {
      numero: 1, nombre: '1er nivel', columnas: 20, filas: 8,
      elementos: [
        { tipo: 'AREA_COMUN', etiqueta: 'Garaje', x: 0, y: 0, ancho: 4, alto: 4 },
        { tipo: 'RECEPCION', etiqueta: 'Recepción · hall', x: 0, y: 4, ancho: 3, alto: 4 },
        { tipo: 'ESCALERA', x: 3, y: 4, ancho: 1, alto: 4 },
        { tipo: 'AREA_COMUN', etiqueta: 'Sala · comedor · cocineta', x: 4, y: 0, ancho: 5, alto: 8 },
        { tipo: 'PASILLO', x: 9, y: 3, ancho: 9, alto: 2 },
        { tipo: 'BANO_COMUN', etiqueta: 'SS.HH.', x: 12, y: 5, ancho: 3, alto: 3 },
        { tipo: 'AREA_COMUN', etiqueta: 'Patio', x: 18, y: 0, ancho: 2, alto: 5 },
        { tipo: 'BANO_COMUN', etiqueta: 'SS.HH.', x: 18, y: 5, ancho: 2, alto: 3 },
      ],
      habitaciones: [['101', 9, 0], ['102', 12, 0], ['103', 15, 0], ['104', 9, 5], ['105', 15, 5]],
    },
    {
      numero: 2, nombre: '2do nivel', columnas: 19, filas: 8,
      elementos: [
        { tipo: 'BANO_COMUN', etiqueta: 'SS.HH.', x: 3, y: 0, ancho: 2, alto: 3 },
        { tipo: 'BANO_COMUN', etiqueta: 'SS.HH.', x: 11, y: 0, ancho: 2, alto: 3 },
        { tipo: 'PASILLO', x: 0, y: 3, ancho: 19, alto: 2 },
        { tipo: 'ESCALERA', x: 3, y: 5, ancho: 3, alto: 3 },
        { tipo: 'BANO_COMUN', etiqueta: 'SS.HH.', x: 6, y: 5, ancho: 2, alto: 3 },
        { tipo: 'BANO_COMUN', etiqueta: 'SS.HH.', x: 14, y: 5, ancho: 2, alto: 3 },
      ],
      habitaciones: [['201', 0, 0], ['202', 5, 0], ['203', 8, 0], ['204', 13, 0], ['205', 16, 0], ['206', 0, 5], ['207', 8, 5], ['208', 11, 5], ['209', 16, 5]],
    },
  ];
  for (const n of real) {
    const piso = await prisma.piso.create({ data: { sucursal_id: centro.id, numero: n.numero, nombre: n.nombre, plano_columnas: n.columnas, plano_filas: n.filas } });
    await prisma.plano_elemento.createMany({ data: n.elementos.map((e) => ({ piso_id: piso.id, etiqueta: null, ...e })) });
    // La doble es la 105 (la del fondo del primer nivel, junto al patio)
    for (const [numero, x, y] of n.habitaciones) await crearHabitacion(centro.id, piso.id, numero, numero === '105' ? doble : matrimonial, x, y, 3, 3);
  }

  // Hostal Alto Tacna: plano de partida (habitaciones arriba y abajo de un pasillo con escalera, S-06)
  for (const [num, cant] of [[1, 6], [2, 6]] as const) {
    const dist = distribucionInicial(cant);
    const piso = await prisma.piso.create({ data: { sucursal_id: alto.id, numero: num, nombre: `Piso ${num}`, plano_columnas: dist.columnas, plano_filas: dist.filas } });
    await prisma.plano_elemento.createMany({
      data: [
        { piso_id: piso.id, tipo: 'PASILLO', ...dist.pasillo },
        { piso_id: piso.id, tipo: num === 1 ? 'RECEPCION' : 'ESCALERA', etiqueta: num === 1 ? 'Recepción' : null, ...dist.escalera },
      ],
    });
    for (let k = 1; k <= cant; k++) {
      const numero = `${num}${String(k).padStart(2, '0')}`;
      await crearHabitacion(alto.id, piso.id, numero, tipos[(k - 1) % 3], dist.habitaciones[k - 1].x, dist.habitaciones[k - 1].y);
    }
  }

  // Huéspedes y estancias activas de ejemplo para que el tablero muestre ocupación real
  const dni = await prisma.tipo_documento_identidad.findUniqueOrThrow({ where: { codigo_sunat: '1' } });
  const pas = await prisma.tipo_documento_identidad.findUniqueOrThrow({ where: { codigo_sunat: '7' } });
  const huespedes = [
    { tipo: dni.id, doc: '45678912', nombres: 'Carlos', apellidos: 'Mendoza Ríos', pais: 'PE' },
    { tipo: pas.id, doc: 'CL8834521', nombres: 'Valentina', apellidos: 'Soto', pais: 'CL' },
    { tipo: dni.id, doc: '70123456', nombres: 'Lucía', apellidos: 'Gutiérrez Paz', pais: 'PE' },
    { tipo: pas.id, doc: 'BO552310', nombres: 'Diego', apellidos: 'Arce', pais: 'BO' },
  ];
  const clientes = [];
  for (const c of huespedes) {
    clientes.push(await prisma.cliente.create({ data: { empresa_id: empresa.id, tipo_documento_id: c.tipo, numero_documento: c.doc, nombres: c.nombres, apellidos: c.apellidos, pais_codigo: c.pais } }));
  }
  const ahora = Date.now();
  // Hotel Centro: parejas por horas (el promedio son 4 h) y una noche completa; pagaron al entrar.
  // [habitación, cliente, horas turno, turnos, horas desde el check-in, método de pago]
  const ocupadas: Array<[string, number, number, number, number, 'EFECTIVO' | 'CULQI' | null]> = [
    [`${centro.id}-102`, 0, 4, 1, 1.5, 'EFECTIVO'],
    [`${centro.id}-104`, 1, 4, 1, 3.6, 'CULQI'], // por vencer
    [`${centro.id}-203`, 2, 3, 1, 3.7, 'EFECTIVO'], // vencida
    [`${centro.id}-205`, 3, 6, 1, 1, 'CULQI'],
    [`${centro.id}-207`, 0, 24, 1, 2, 'EFECTIVO'], // noche completa: sale a las 9:00
    [`${alto.id}-102`, 0, 12, 1, 3, null], // el hostal cobra al salir
  ];
  const pagadas: Array<{ estanciaId: bigint; habitacion: string; tipo: string; horas: number; cantidad: number; precio: number; metodo: 'EFECTIVO' | 'CULQI'; cliente: (typeof clientes)[number]; fecha: Date }> = [];
  for (const [key, ci, horas, cant, desde, metodo] of ocupadas) {
    const checkin = new Date(ahora - h(desde));
    const suc = Number(key.split('-')[0]);
    const habitacion = await prisma.habitacion.update({ where: { id: habs[key] }, data: { estado_habitacion_id: eid('OCUPADA') }, include: { tipo_habitacion: true } });
    const tarifa = await prisma.tarifa.findFirstOrThrow({ where: { sucursal_id: suc, tipo_habitacion_id: habitacion.tipo_habitacion_id, canal_venta_id: canales[0].id, turno_id: turno(horas).id } });
    const precio = Number(tarifa.precio);
    const salida = horas === 24 && suc === centro.id ? salidaNoche(checkin, '09:00', cant) : new Date(checkin.getTime() + h(horas * cant));
    const e = await prisma.estancia.create({
      data: {
        sucursal_id: suc, habitacion_id: habs[key], canal_venta_id: canales[0].id, turno_id: turno(horas).id,
        checkin_at: checkin, checkout_previsto: salida, cantidad_turnos: cant, precio_unitario: precio,
        procedencia: clientes[ci].pais_codigo === 'PE' ? 'Tacna, Perú' : 'Exterior', usuario_checkin_id: creados.recepcion1,
        estancia_huesped: { create: [{ cliente_id: clientes[ci].id, es_titular: true }] },
      },
    });
    if (metodo) pagadas.push({ estanciaId: e.id, habitacion: habitacion.numero, tipo: habitacion.tipo_habitacion.nombre, horas, cantidad: cant, precio: precio * cant, metodo, cliente: clientes[ci], fecha: checkin });
  }
  // Limpieza: la 103 lleva 40 min (pasó los 30 esperados) y la 201, 10 min. El historial dice desde cuándo.
  const otros: Array<[string, string, number]> = [
    [`${centro.id}-103`, 'LIMPIEZA', 40], [`${centro.id}-201`, 'LIMPIEZA', 10], [`${centro.id}-209`, 'MANTENIMIENTO', 300],
    [`${alto.id}-201`, 'RESERVADA', 60], [`${alto.id}-105`, 'MANTENIMIENTO', 300],
  ];
  for (const [key, est, minutos] of otros) {
    await prisma.habitacion.update({ where: { id: habs[key] }, data: { estado_habitacion_id: eid(est) } });
    const ultimo = await prisma.habitacion_estado_historial.findFirst({ where: { habitacion_id: habs[key] }, orderBy: { id: 'desc' } });
    if (ultimo) await prisma.habitacion_estado_historial.update({ where: { id: ultimo.id }, data: { fecha_hora: new Date(ahora - minutos * 60_000), motivo: est === 'LIMPIEZA' ? 'Check-out' : 'Revisión' } });
  }

  // Productos para consumos de la estadía (S-07). El control de stock llega con inventario (F4).
  const um = async (codigo: string) => (await prisma.unidad_medida.findFirstOrThrow({ where: { codigo_sunat: codigo } })).id;
  const gravado = (await prisma.tipo_afectacion_igv.findFirstOrThrow({ where: { codigo_sunat: '10' } })).id;
  const catFrigobar = await prisma.categoria_producto.create({ data: { empresa_id: empresa.id, nombre: 'Frigobar' } });
  const catServicios = await prisma.categoria_producto.create({ data: { empresa_id: empresa.id, nombre: 'Servicios' } });
  const productos: Array<[string, string, number, 'BIEN' | 'SERVICIO', number]> = [
    ['AGUA625', 'Agua mineral 625 ml', 3, 'BIEN', catFrigobar.id],
    ['GASEOSA500', 'Gaseosa 500 ml', 4, 'BIEN', catFrigobar.id],
    ['CERVEZA', 'Cerveza 330 ml', 8, 'BIEN', catFrigobar.id],
    ['SNACK', 'Snack (papas o galletas)', 3.5, 'BIEN', catFrigobar.id],
    ['DESAYUNO', 'Desayuno continental', 15, 'SERVICIO', catServicios.id],
    ['LAVANDERIA', 'Lavandería (por prenda)', 5, 'SERVICIO', catServicios.id],
    ['COCHERA', 'Cochera (por noche)', 10, 'SERVICIO', catServicios.id],
  ];
  for (const [codigo, nombre, precio, tipo, cat] of productos) {
    await prisma.producto.create({
      data: { empresa_id: empresa.id, categoria_id: cat, codigo, nombre, tipo, unidad_medida_id: await um(tipo === 'BIEN' ? 'NIU' : 'ZZ'), tipo_afectacion_igv_id: gravado, precio_venta: precio, controla_stock: false },
    });
  }

  // Reservas de ejemplo para el calendario (S-06): llegadas de hoy y de los próximos días
  const hoy = fechaLima(new Date());
  const dia = (n: number) => { const d = new Date(`${hoy}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const masHuespedes = [
    { tipo: dni.id, doc: '42315678', nombres: 'Martín', apellidos: 'Quispe Rojas', pais: 'PE' },
    { tipo: dni.id, doc: '40998877', nombres: 'Gabriela', apellidos: 'Torres Vela', pais: 'PE' },
    { tipo: pas.id, doc: 'AR3399120', nombres: 'Julián', apellidos: 'Ferreyra', pais: 'AR' },
  ];
  for (const c of masHuespedes) {
    clientes.push(await prisma.cliente.create({ data: { empresa_id: empresa.id, tipo_documento_id: c.tipo, numero_documento: c.doc, nombres: c.nombres, apellidos: c.apellidos, pais_codigo: c.pais } }));
  }
  // Reservas sin adelanto (el hotel no cobra al reservar y no todas se usan): una de hoy que no llegó
  // (para marcar «no se presentó»), una para dentro de un rato y noches de los próximos días.
  const ejemplos: Array<{ hab: string; ci: number; cn: number; entrada: Date; horas: number; cant: number; estado: 'PENDIENTE' | 'CONFIRMADA'; hoy?: boolean }> = [
    { hab: '202', ci: 4, cn: 2, entrada: new Date(ahora - h(1.5)), horas: 4, cant: 1, estado: 'PENDIENTE', hoy: true }, // no llegó
    { hab: '206', ci: 5, cn: 2, entrada: new Date(ahora + h(2)), horas: 4, cant: 1, estado: 'CONFIRMADA', hoy: true },
    { hab: '208', ci: 6, cn: 0, entrada: rangoPorNoches(dia(1), 1).entrada, horas: 24, cant: 1, estado: 'PENDIENTE' },
    { hab: '101', ci: 1, cn: 1, entrada: rangoPorNoches(dia(2), 1).entrada, horas: 24, cant: 2, estado: 'CONFIRMADA' },
    { hab: '204', ci: 2, cn: 2, entrada: rangoPorNoches(dia(3), 1).entrada, horas: 3, cant: 1, estado: 'PENDIENTE' },
  ];
  for (const [i, r] of ejemplos.entries()) {
    const hab = await prisma.habitacion.findUniqueOrThrow({ where: { id: habs[`${centro.id}-${r.hab}`] } });
    const tarifa = await prisma.tarifa.findFirstOrThrow({ where: { sucursal_id: centro.id, tipo_habitacion_id: hab.tipo_habitacion_id, canal_venta_id: canales[r.cn].id, turno_id: turno(r.horas).id } });
    const salida = r.horas === 24 ? salidaNoche(r.entrada, '09:00', r.cant) : new Date(r.entrada.getTime() + h(r.horas * r.cant));
    await prisma.reserva.create({
      data: {
        sucursal_id: centro.id, codigo: codigoReserva(i + 1), cliente_id: clientes[r.ci].id, canal_venta_id: canales[r.cn].id, comision_porcentaje: canales[r.cn].comision_porcentaje,
        codigo_externo: canales[r.cn].es_ota ? `BK-${4410200 + i * 37}` : null, fecha_entrada: r.entrada, fecha_salida: salida,
        adultos: 2, estado: r.estado, moneda_id: pen.id, monto_total: Number(tarifa.precio) * r.cant, monto_adelanto: 0,
        observaciones: r.estado === 'CONFIRMADA' ? 'Confirmó por teléfono; paga al llegar' : null, usuario_id: creados.recepcion1,
        reserva_habitacion: { create: [{ habitacion_id: hab.id, tarifa_id: tarifa.id, turno_id: turno(r.horas).id, fecha_entrada: r.entrada, fecha_salida: salida, cantidad_turnos: r.cant, precio_unitario: tarifa.precio }] },
      },
    });
    if (r.hoy) await prisma.habitacion.update({ where: { id: hab.id }, data: { estado_habitacion_id: eid(r.estado === 'CONFIRMADA' ? 'CONFIRMADA' : 'RESERVADA') } });
  }

  // Series compartidas por sucursal (sin usuarios asignados: las usa cualquiera, S-07 D4) y cajas
  const tc = await prisma.tipo_comprobante.findMany();
  const tcid = (c: string) => tc.find((t) => t.codigo === c)!.id;
  for (const [suc, n] of [[centro.id, 1], [alto.id, 2]] as const) {
    for (const [cod, pref] of [['FACTURA', 'F'], ['BOLETA', 'B'], ['INTERNO', 'I']] as const) {
      await prisma.serie.create({ data: { sucursal_id: suc, tipo_comprobante_id: tcid(cod), serie: `${pref}00${n}` } });
    }
    await prisma.caja.create({ data: { sucursal_id: suc, nombre: 'Recepción 1' } });
  }

  // Operación real del Hotel Centro (información del cuartelero): pago adelantado, sin consumos, limpieza de 30 min,
  // noche con salida a las 9:00 y hora máxima de salida según la hora del check-in. El hostal sigue las de siempre.
  await prisma.sucursal_operacion.create({
    data: { sucursal_id: centro.id, cobro_al_ingreso: true, vende_consumos: false, minutos_limpieza: 30, hora_salida_noche: new Date('1970-01-01T09:00:00Z'), turno_sugerido_id: turno(4).id },
  });
  await prisma.sucursal_franja_salida.createMany({
    data: FRANJAS_SUGERIDAS.map((f) => ({
      sucursal_id: centro.id, nombre: f.nombre, desde: new Date(`1970-01-01T${f.desde}:00Z`), hasta: new Date(`1970-01-01T${f.hasta}:00Z`),
      salida_maxima: new Date(`1970-01-01T${f.salidaMaxima}:00Z`), dias_despues: f.diasDespues,
    })),
  });

  // Boletas de lo cobrado al ingreso en el turno anterior (su caja ya se cerró)
  const boleta = await prisma.serie.findFirstOrThrow({ where: { sucursal_id: centro.id, tipo_comprobante_id: tcid('BOLETA') } });
  const [zz, afecto, metodos] = await Promise.all([
    prisma.unidad_medida.findFirstOrThrow({ where: { codigo_sunat: 'ZZ' } }),
    prisma.tipo_afectacion_igv.findFirstOrThrow({ where: { codigo_sunat: '10' } }),
    prisma.metodo_pago.findMany(),
  ]);
  for (const [n, p] of pagadas.entries()) {
    const des = desglosarIgv(Math.round(p.precio * 100));
    const total = p.precio.toFixed(2);
    const lima = new Date(p.fecha.getTime() - 5 * 3_600_000).toISOString();
    const unidad = p.horas === 24 ? `${p.cantidad} ${p.cantidad === 1 ? 'noche' : 'noches'}` : `${p.cantidad} × turno de ${p.horas} h`;
    await prisma.comprobante.create({
      data: {
        sucursal_id: centro.id, serie_id: boleta.id, tipo_comprobante_id: tcid('BOLETA'), serie: boleta.serie, numero: n + 1,
        fecha_emision: new Date(`${lima.slice(0, 10)}T00:00:00Z`), hora_emision: new Date(`1970-01-01T${lima.slice(11, 19)}Z`),
        cliente_id: p.cliente.id, cliente_tipo_doc: p.cliente.tipo_documento_id === dni.id ? '1' : '7', cliente_num_doc: p.cliente.numero_documento,
        cliente_nombre: `${p.cliente.nombres} ${p.cliente.apellidos}`, moneda_id: pen.id, estancia_id: p.estanciaId,
        total_gravada: (des.valorVenta / 100).toFixed(2), total_igv: (des.igv / 100).toFixed(2), total, monto_letras: montoEnLetras(total), usuario_id: creados.recepcion1,
        comprobante_detalle: {
          create: [{
            item: 1, estancia_id: p.estanciaId, descripcion: `Hospedaje hab. ${p.habitacion} (${p.tipo}) · ${unidad}`, unidad_medida_id: zz.id, tipo_afectacion_igv_id: afecto.id,
            cantidad: p.cantidad, valor_unitario: (des.valorVenta / 100 / p.cantidad).toFixed(4), precio_unitario: (p.precio / p.cantidad).toFixed(2),
            valor_venta: (des.valorVenta / 100).toFixed(2), igv: (des.igv / 100).toFixed(2), total,
          }],
        },
        comprobante_pago: { create: [{ metodo_pago_id: metodos.find((m) => m.codigo === p.metodo)!.id, monto: total, referencia: p.metodo === 'CULQI' ? `chr_demo_${n + 1}` : null }] },
      },
    });
  }
  if (pagadas.length) await prisma.serie.update({ where: { id: boleta.id }, data: { correlativo_actual: pagadas.length } });

  console.log(`Datos de ejemplo cargados. Usuarios: ${usuarios.map((u) => u.username).join(', ')} · contraseña: ${CLAVE_DEMO}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
