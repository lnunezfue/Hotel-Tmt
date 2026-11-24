/**
 * Datos de EJEMPLO para desarrollo y demo (no son datos reales del hotel).
 * Los catálogos SUNAT ya los carga la migración inicial. Ejecutar: pnpm db:seed
 */
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import * as argon2 from 'argon2';
import 'dotenv/config';
import { distribucionInicial } from '../src/modules/hospedaje/domain/plano';
import { codigoReserva, fechaLima, rangoPorNoches } from '../src/modules/reservas/domain/reserva';

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
    RECEPCIONISTA: ['reserva.ver', 'reserva.crear', 'reserva.cancelar', 'estancia.checkin', 'estancia.checkout', 'comprobante.emitir', 'descuento.aplicar', 'caja.abrir', 'caja.cerrar', 'habitacion.cambiar_estado'],
    CAJERO: ['comprobante.emitir', 'caja.abrir', 'caja.cerrar'],
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
  const turnos = await prisma.turno.findMany();
  const turno = (horas: number) => turnos.find((t) => t.duracion_horas === horas)!;
  const pen = await prisma.moneda.findUniqueOrThrow({ where: { codigo_iso: 'PEN' } });

  // Tarifas de ejemplo: precio base por tipo (24 h) y factor por turno y canal
  const base = [70, 110, 120, 220];
  const factorTurno: Record<number, number> = { 24: 1, 12: 0.7, 6: 0.5, 3: 0.35 };
  for (const suc of [centro, alto]) {
    for (const [i, t] of tipos.entries()) {
      for (const tu of turnos) {
        for (const c of canales) {
          const precio = Math.round(base[i] * factorTurno[tu.duracion_horas] * (c.nombre === 'Booking' ? 1.15 : 1) * (suc.id === alto.id ? 0.8 : 1));
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

  // Pisos y habitaciones
  const plan: Array<{ suc: number; pisos: Array<[number, number]> }> = [
    { suc: centro.id, pisos: [[1, 8], [2, 8], [3, 6]] },
    { suc: alto.id, pisos: [[1, 6], [2, 6]] },
  ];
  const habs: Record<string, number> = {};
  for (const p of plan) {
    for (const [num, cant] of p.pisos) {
      // Plano de partida: habitaciones arriba y abajo de un pasillo con escalera (S-06)
      const dist = distribucionInicial(cant);
      const piso = await prisma.piso.create({ data: { sucursal_id: p.suc, numero: num, nombre: `Piso ${num}`, plano_columnas: dist.columnas, plano_filas: dist.filas } });
      await prisma.plano_elemento.createMany({
        data: [
          { piso_id: piso.id, tipo: 'PASILLO', ...dist.pasillo },
          { piso_id: piso.id, tipo: num === 1 ? 'RECEPCION' : 'ESCALERA', etiqueta: num === 1 ? 'Recepción' : null, ...dist.escalera },
        ],
      });
      for (let k = 1; k <= cant; k++) {
        const numero = `${num}${String(k).padStart(2, '0')}`;
        const tipo = num === 3 && k >= 5 ? tipos[3] : tipos[(k - 1) % 3];
        const hab = await prisma.habitacion.create({
          data: {
            sucursal_id: p.suc, piso_id: piso.id, tipo_habitacion_id: tipo.id, estado_habitacion_id: eid('DESOCUPADA'), numero,
            plano_x: dist.habitaciones[k - 1].x, plano_y: dist.habitaciones[k - 1].y,
            habitacion_amenidad: { create: equipamiento(tipo.nombre, numero).map((c) => ({ amenidad_id: amen[c] })) },
          },
        });
        habs[`${p.suc}-${numero}`] = hab.id;
      }
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
  const ocupadas: Array<[string, number, number, number, number]> = [
    // [habitación, cliente, horas turno, turnos, horas desde el check-in]
    [`${centro.id}-101`, 0, 24, 2, 20],
    [`${centro.id}-104`, 1, 24, 1, 6],
    [`${centro.id}-202`, 2, 3, 1, 2.75], // por vencer
    [`${centro.id}-205`, 3, 6, 1, 7], // vencida
    [`${alto.id}-102`, 0, 12, 1, 3],
  ];
  for (const [key, ci, horas, cant, desde] of ocupadas) {
    const checkin = new Date(ahora - h(desde));
    await prisma.habitacion.update({ where: { id: habs[key] }, data: { estado_habitacion_id: eid('OCUPADA') } });
    const precio = 100;
    await prisma.estancia.create({
      data: {
        sucursal_id: Number(key.split('-')[0]), habitacion_id: habs[key], canal_venta_id: canales[ci % 2].id, turno_id: turno(horas).id,
        checkin_at: checkin, checkout_previsto: new Date(checkin.getTime() + h(horas * cant)), cantidad_turnos: cant, precio_unitario: precio,
        procedencia: clientes[ci].pais_codigo === 'PE' ? 'Lima, Perú' : 'Exterior', usuario_checkin_id: creados.recepcion1,
        estancia_huesped: { create: [{ cliente_id: clientes[ci].id, es_titular: true }] },
      },
    });
  }
  const otros: Array<[string, string]> = [
    [`${centro.id}-102`, 'LIMPIEZA'], [`${centro.id}-107`, 'MANTENIMIENTO'], [`${centro.id}-203`, 'RESERVADA'],
    [`${centro.id}-301`, 'CONFIRMADA'], [`${centro.id}-206`, 'LIMPIEZA'], [`${alto.id}-201`, 'RESERVADA'], [`${alto.id}-105`, 'MANTENIMIENTO'],
  ];
  for (const [key, est] of otros) await prisma.habitacion.update({ where: { id: habs[key] }, data: { estado_habitacion_id: eid(est) } });

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
  const precioTarifa = (tipoIdx: number, canalIdx: number) => Math.round(base[tipoIdx] * (canales[canalIdx].nombre === 'Booking' ? 1.15 : 1));
  const tipoIdx = (habKey: string) => { const n = Number(habKey.split('-')[1].slice(-2)); const piso = habKey.split('-')[1][0]; return piso === '3' && n >= 5 ? 3 : (n - 1) % 3; };
  const ejemplos: Array<[string, number, number, number, number, 'PENDIENTE' | 'CONFIRMADA']> = [
    // [habitación, cliente, canal, llega en (días), noches, estado]
    [`${centro.id}-203`, 4, 0, 0, 2, 'PENDIENTE'],
    [`${centro.id}-301`, 5, 1, 0, 3, 'CONFIRMADA'],
    [`${centro.id}-103`, 6, 2, 1, 2, 'CONFIRMADA'],
    [`${centro.id}-201`, 1, 1, 2, 4, 'CONFIRMADA'],
    [`${centro.id}-305`, 3, 1, 3, 2, 'PENDIENTE'],
    [`${centro.id}-106`, 2, 0, 4, 1, 'PENDIENTE'],
    [`${centro.id}-204`, 5, 2, 5, 3, 'CONFIRMADA'],
    [`${centro.id}-108`, 6, 1, 6, 2, 'PENDIENTE'],
  ];
  for (const [i, [key, ci, cn, en, noches, estado]] of ejemplos.entries()) {
    const r = rangoPorNoches(dia(en), noches);
    const precio = precioTarifa(tipoIdx(key), cn);
    await prisma.reserva.create({
      data: {
        sucursal_id: centro.id, codigo: codigoReserva(i + 1), cliente_id: clientes[ci].id, canal_venta_id: canales[cn].id, comision_porcentaje: canales[cn].comision_porcentaje,
        codigo_externo: canales[cn].es_ota ? `BK-${4410200 + i * 37}` : null, fecha_entrada: r.entrada, fecha_salida: r.salida,
        adultos: 1, estado, moneda_id: pen.id, monto_total: precio * noches, monto_adelanto: estado === 'CONFIRMADA' ? precio : 0,
        usuario_id: creados.recepcion1,
        reserva_habitacion: { create: [{ habitacion_id: habs[key], turno_id: turno(24).id, fecha_entrada: r.entrada, fecha_salida: r.salida, cantidad_turnos: noches, precio_unitario: precio }] },
      },
    });
  }

  // Series y cajas (preparadas para la fase de facturación)
  const tc = await prisma.tipo_comprobante.findMany();
  const tcid = (c: string) => tc.find((t) => t.codigo === c)!.id;
  for (const [suc, n] of [[centro.id, 1], [alto.id, 2]] as const) {
    for (const [cod, pref] of [['FACTURA', 'F'], ['BOLETA', 'B'], ['INTERNO', 'I']] as const) {
      const s = await prisma.serie.create({ data: { sucursal_id: suc, tipo_comprobante_id: tcid(cod), serie: `${pref}00${n}` } });
      await prisma.usuario_serie.create({ data: { usuario_id: creados.admin, serie_id: s.id } });
    }
    await prisma.caja.create({ data: { sucursal_id: suc, nombre: 'Recepción 1' } });
  }

  console.log(`Datos de ejemplo cargados. Usuarios: ${usuarios.map((u) => u.username).join(', ')} · contraseña: ${CLAVE_DEMO}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
