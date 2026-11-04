/**
 * Datos de EJEMPLO para desarrollo y demo (no son datos reales del hotel).
 * Los catálogos SUNAT ya los carga la migración inicial. Ejecutar: pnpm db:seed
 */
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import * as argon2 from 'argon2';
import 'dotenv/config';

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
  ];
  for (const p of extra) await prisma.permiso.upsert({ where: { codigo: p.codigo }, update: {}, create: p });
  await prisma.rol.upsert({ where: { nombre: 'LIMPIEZA' }, update: {}, create: { nombre: 'LIMPIEZA', descripcion: 'Solo cambia el estado de habitaciones' } });

  const permisos = await prisma.permiso.findMany();
  const pid = (c: string) => permisos.find((p) => p.codigo === c)!.id;
  const roles = await prisma.rol.findMany();
  const rid = (n: string) => roles.find((r) => r.nombre === n)!.id;
  const asignacion: Record<string, string[]> = {
    ADMINISTRADOR: permisos.map((p) => p.codigo),
    RECEPCIONISTA: ['reserva.crear', 'reserva.cancelar', 'estancia.checkin', 'estancia.checkout', 'comprobante.emitir', 'descuento.aplicar', 'caja.abrir', 'caja.cerrar', 'habitacion.cambiar_estado'],
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
    [['Simple', 1], ['Doble', 2], ['Matrimonial', 2], ['Suite', 3]].map(([nombre, cap]) =>
      prisma.tipo_habitacion.create({ data: { empresa_id: empresa.id, nombre: nombre as string, capacidad_adultos: cap as number } }),
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

  // Pisos y habitaciones
  const plan: Array<{ suc: number; pisos: Array<[number, number]> }> = [
    { suc: centro.id, pisos: [[1, 8], [2, 8], [3, 6]] },
    { suc: alto.id, pisos: [[1, 6], [2, 6]] },
  ];
  const habs: Record<string, number> = {};
  for (const p of plan) {
    for (const [num, cant] of p.pisos) {
      const piso = await prisma.piso.create({ data: { sucursal_id: p.suc, numero: num, nombre: `Piso ${num}` } });
      for (let k = 1; k <= cant; k++) {
        const numero = `${num}${String(k).padStart(2, '0')}`;
        const tipo = num === 3 && k >= 5 ? tipos[3] : tipos[(k - 1) % 3];
        const hab = await prisma.habitacion.create({
          data: { sucursal_id: p.suc, piso_id: piso.id, tipo_habitacion_id: tipo.id, estado_habitacion_id: eid('DESOCUPADA'), numero },
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
