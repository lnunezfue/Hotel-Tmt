import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsuarioSesion } from '../../../common/usuario-actual.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { AvisosTablero } from '../../hospedaje/application/avisos-tablero.service';
import { ConfiguracionService } from '../../hospedaje/application/configuracion.service';
import { sumarDias } from '../../hospedaje/domain/tarifa';
import { validarTransicion, esEstado, TransicionInvalidaError } from '../../hospedaje/domain/estado-habitacion';
import {
  AccionReserva,
  aplicarAccion,
  codigoReserva,
  ESTADOS_QUE_OCUPAN,
  EstadoReserva,
  fechaLima,
  instanteLima,
  rangoPorHoras,
  rangoPorNoches,
  ReglaReservaError,
  validarHuespedes,
} from '../domain/reserva';

export interface NuevaReserva {
  clienteId: number;
  canalId: number;
  turnoId: number;
  habitacionId: number;
  llegada: string;
  /** Noches (turno de 24 h) o turnos (3, 6 o 12 h). */
  cantidad: number;
  /** Solo para turnos por horas: HH:MM. */
  hora?: string;
  adultos: number;
  ninos: number;
  adelanto?: number;
  confirmar?: boolean;
  codigoExterno?: string | null;
  observaciones?: string | null;
}

type Tx = Prisma.TransactionClient;

/** El trigger de solape de la base responde SQLSTATE 45000: se traduce a 409 con su mismo mensaje. */
function traducir(e: unknown): never {
  if (e instanceof ReglaReservaError) throw new BadRequestException(e.message);
  if (e instanceof TransicionInvalidaError) throw new ConflictException(`La habitación no está lista: ${e.message}`);
  const texto = e instanceof Error ? e.message : '';
  const m = /(La habitación ya está reservada[^"'\n]*|La habitación está ocupada[^"'\n]*)/.exec(texto);
  if (m) throw new ConflictException(m[1].trim());
  throw e;
}

const SELECCION = {
  id: true,
  codigo: true,
  estado: true,
  fecha_entrada: true,
  fecha_salida: true,
  adultos: true,
  ninos: true,
  monto_total: true,
  monto_adelanto: true,
  observaciones: true,
  codigo_externo: true,
  motivo_cancelacion: true,
  created_at: true,
  canal_venta: { select: { id: true, nombre: true, es_ota: true } },
  cliente: { select: { id: true, numero_documento: true, nombre_completo: true, razon_social: true, telefono: true, pais_codigo: true, tipo_documento: { select: { abreviatura: true } } } },
  reserva_habitacion: {
    where: { estado: 'ACTIVA' as const },
    select: {
      id: true,
      cantidad_turnos: true,
      precio_unitario: true,
      turno: { select: { id: true, nombre: true, duracion_horas: true } },
      habitacion: { select: { id: true, numero: true, tipo_habitacion: { select: { nombre: true } } } },
    },
  },
} satisfies Prisma.reservaSelect;

type FilaReserva = Prisma.reservaGetPayload<{ select: typeof SELECCION }>;

/** Reservas de la sucursal del token (spec S-06 §5): disponibilidad, alta con precio vigente, estados y check-in. */
@Injectable()
export class ReservasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly avisos: AvisosTablero,
    private readonly config: ConfiguracionService,
  ) {}

  /** Reservas que se cruzan con [desde, hasta] (fechas de Lima), para el calendario. */
  async listar(sucursalId: number, desde: string, hasta: string) {
    const inicio = instanteLima(desde, 0);
    const fin = instanteLima(sumarDias(hasta, 1), 0);
    const filas = await this.prisma.reserva.findMany({
      where: { sucursal_id: sucursalId, fecha_entrada: { lt: fin }, fecha_salida: { gt: inicio }, estado: { notIn: ['CANCELADA'] } },
      orderBy: { fecha_entrada: 'asc' },
      select: SELECCION,
    });
    return filas.map((f) => this.vista(f));
  }

  async detalle(sucursalId: number, id: number) {
    const f = await this.prisma.reserva.findFirst({ where: { id, sucursal_id: sucursalId }, select: SELECCION });
    if (!f) throw new NotFoundException('La reserva no existe en tu sucursal');
    return this.vista(f);
  }

  /**
   * Qué habitaciones están libres en el rango pedido. Ocupan: reservas abiertas y estancias activas que se
   * cruzan. Una habitación en mantenimiento se informa pero no se bloquea (puede estar lista para la fecha).
   */
  async disponibilidad(sucursalId: number, q: { llegada: string; cantidad: number; turnoId: number; hora?: string }) {
    const turno = await this.prisma.turno.findUnique({ where: { id: q.turnoId } });
    if (!turno) throw new BadRequestException('Turno no válido');
    let rango: { entrada: Date; salida: Date };
    try {
      rango = turno.duracion_horas === 24 ? rangoPorNoches(q.llegada, q.cantidad) : rangoPorHoras(q.llegada, q.hora ?? '14:00', turno.duracion_horas, q.cantidad);
    } catch (e) {
      traducir(e);
    }
    const [habs, reservas, estancias] = await Promise.all([
      this.prisma.habitacion.findMany({
        where: { sucursal_id: sucursalId, activo: true, piso: { activo: true } },
        select: { id: true, numero: true, estado_habitacion: { select: { codigo: true } }, tipo_habitacion: { select: { id: true, nombre: true, capacidad_adultos: true, capacidad_ninos: true } } },
        orderBy: { numero: 'asc' },
      }),
      this.prisma.reserva_habitacion.findMany({
        where: { estado: 'ACTIVA', fecha_entrada: { lt: rango.salida }, fecha_salida: { gt: rango.entrada }, reserva: { sucursal_id: sucursalId, estado: { in: ESTADOS_QUE_OCUPAN } } },
        select: { habitacion_id: true, reserva: { select: { codigo: true, cliente: { select: { nombre_completo: true, razon_social: true } } } } },
      }),
      this.prisma.estancia.findMany({
        where: { sucursal_id: sucursalId, estado: 'ACTIVA', checkin_at: { lt: rango.salida }, checkout_previsto: { gt: rango.entrada } },
        select: { habitacion_id: true },
      }),
    ]);
    return {
      entrada: rango.entrada,
      salida: rango.salida,
      habitaciones: habs.map((h) => {
        const r = reservas.find((x) => x.habitacion_id === h.id);
        const ocupada = estancias.some((e) => e.habitacion_id === h.id);
        return {
          id: h.id,
          numero: h.numero,
          tipo: { id: h.tipo_habitacion.id, nombre: h.tipo_habitacion.nombre, adultos: h.tipo_habitacion.capacidad_adultos, ninos: h.tipo_habitacion.capacidad_ninos },
          libre: !r && !ocupada,
          motivo: r ? `Reservada (${r.reserva.codigo} · ${r.reserva.cliente.nombre_completo ?? r.reserva.cliente.razon_social})` : ocupada ? 'Ocupada en esas fechas' : null,
          aviso: h.estado_habitacion.codigo === 'MANTENIMIENTO' ? 'En mantenimiento ahora' : null,
        };
      }),
    };
  }

  async crear(actor: UsuarioSesion, d: NuevaReserva) {
    const c = { empresaId: actor.empresaId, sucursalId: actor.sucursalId };
    const [hab, turno, cliente] = await Promise.all([
      this.prisma.habitacion.findFirst({ where: { id: d.habitacionId, sucursal_id: c.sucursalId, activo: true }, include: { tipo_habitacion: true, estado_habitacion: true } }),
      this.prisma.turno.findFirst({ where: { id: d.turnoId, activo: true } }),
      this.prisma.cliente.findFirst({ where: { id: d.clienteId, empresa_id: c.empresaId, activo: true } }),
    ]);
    if (!hab) throw new BadRequestException('La habitación no existe o está inactiva en tu sucursal');
    if (!turno) throw new BadRequestException('Turno no válido');
    if (!cliente) throw new BadRequestException('El huésped no existe');

    let rango: { entrada: Date; salida: Date };
    try {
      rango = turno.duracion_horas === 24 ? rangoPorNoches(d.llegada, d.cantidad) : rangoPorHoras(d.llegada, d.hora ?? '', turno.duracion_horas, d.cantidad);
      if (rango.salida <= new Date()) throw new ReglaReservaError('Las fechas de la reserva ya pasaron');
      validarHuespedes(d.adultos, d.ninos, { adultos: hab.tipo_habitacion.capacidad_adultos, ninos: hab.tipo_habitacion.capacidad_ninos });
    } catch (e) {
      traducir(e);
    }
    // Precio pactado: la tarifa vigente el día de llegada para el tipo, canal y turno (S-04).
    const tarifa = await this.config.precioVigente(c, { tipoId: hab.tipo_habitacion_id, canalId: d.canalId, turnoId: d.turnoId }, d.llegada);
    const precio = new Prisma.Decimal(tarifa.precio);
    const total = precio.mul(d.cantidad);
    const adelanto = new Prisma.Decimal((d.adelanto ?? 0).toFixed(2));
    if (adelanto.lt(0) || adelanto.gt(total)) throw new BadRequestException('El adelanto no puede superar el total');
    const pen = await this.prisma.moneda.findUniqueOrThrow({ where: { codigo_iso: 'PEN' } });
    const esHoy = fechaLima(rango.entrada) === fechaLima(new Date());

    try {
      const creada = await this.prisma.$transaction(async (tx) => {
        // El correlativo se calcula con la sucursal bloqueada: dos altas simultáneas no repiten código.
        await tx.$queryRaw`SELECT id FROM sucursal WHERE id = ${c.sucursalId} FOR UPDATE`;
        const n = (await tx.reserva.count({ where: { sucursal_id: c.sucursalId } })) + 1;
        const estado: EstadoReserva = d.confirmar || adelanto.gt(0) ? 'CONFIRMADA' : 'PENDIENTE';
        const r = await tx.reserva.create({
          data: {
            sucursal_id: c.sucursalId, codigo: codigoReserva(n), cliente_id: d.clienteId, canal_venta_id: d.canalId,
            codigo_externo: d.codigoExterno?.trim() || null, fecha_entrada: rango.entrada, fecha_salida: rango.salida,
            adultos: d.adultos, ninos: d.ninos, estado, moneda_id: pen.id, monto_total: total, monto_adelanto: adelanto,
            observaciones: d.observaciones?.trim() || null, usuario_id: actor.sub,
            reserva_habitacion: {
              create: [{ habitacion_id: hab.id, tarifa_id: tarifa.tarifaId, turno_id: turno.id, fecha_entrada: rango.entrada, fecha_salida: rango.salida, cantidad_turnos: d.cantidad, precio_unitario: precio }],
            },
          },
          select: SELECCION,
        });
        // Llega hoy: la habitación libre pasa a RESERVADA (o CONFIRMADA) para que recepción la vea en el tablero.
        if (esHoy && hab.estado_habitacion.codigo === 'DESOCUPADA') await this.cambiarEstadoHabitacion(tx, hab.id, estado === 'CONFIRMADA' ? 'CONFIRMADA' : 'RESERVADA', actor.sub, `Reserva ${r.codigo}`);
        await this.auditoria.registrar(tx, { accion: 'reserva.crear', tabla: 'reserva', registroId: r.id, despues: { codigo: r.codigo, habitacion: hab.numero, entrada: rango.entrada, salida: rango.salida, total, estado } });
        return r;
      });
      if (esHoy) await this.avisos.avisar(c.sucursalId, 'estado');
      return this.vista(creada);
    } catch (e) {
      traducir(e);
    }
  }

  /** confirmar · cancelar · no_show. El check-in tiene su propio método porque crea la estancia. */
  async cambiarEstado(actor: UsuarioSesion, id: number, accion: Exclude<AccionReserva, 'checkin'>, motivo?: string) {
    const r = await this.prisma.reserva.findFirst({ where: { id, sucursal_id: actor.sucursalId }, include: { reserva_habitacion: { where: { estado: 'ACTIVA' } } } });
    if (!r) throw new NotFoundException('La reserva no existe en tu sucursal');
    let nuevo: EstadoReserva;
    try {
      nuevo = aplicarAccion(r.estado, accion, { entrada: r.fecha_entrada, salida: r.fecha_salida }, new Date());
    } catch (e) {
      traducir(e);
    }
    if (accion === 'cancelar' && !motivo?.trim()) throw new BadRequestException('Indica el motivo de la cancelación');
    const habs = r.reserva_habitacion.map((x) => x.habitacion_id);
    const libera = nuevo === 'CANCELADA' || nuevo === 'NO_SHOW';

    const res = await this.prisma.$transaction(async (tx) => {
      const despues = await tx.reserva.update({
        where: { id },
        data: { estado: nuevo, ...(accion === 'cancelar' && { motivo_cancelacion: motivo!.trim() }) },
        select: SELECCION,
      });
      // El tablero refleja la llegada de hoy: al confirmar pasa a CONFIRMADA; al liberar, vuelve a DESOCUPADA.
      for (const habId of habs) {
        const h = await tx.habitacion.findUniqueOrThrow({ where: { id: habId }, include: { estado_habitacion: true } });
        if (accion === 'confirmar' && h.estado_habitacion.codigo === 'RESERVADA') await this.cambiarEstadoHabitacion(tx, habId, 'CONFIRMADA', actor.sub, `Reserva ${r.codigo} confirmada`);
        if (libera && ['RESERVADA', 'CONFIRMADA'].includes(h.estado_habitacion.codigo)) {
          await this.cambiarEstadoHabitacion(tx, habId, 'DESOCUPADA', actor.sub, `Reserva ${r.codigo} ${nuevo === 'NO_SHOW' ? 'no se presentó' : 'cancelada'}`);
        }
      }
      const accionAud = accion === 'confirmar' ? 'reserva.confirmar' : accion === 'cancelar' ? 'reserva.cancelar' : 'reserva.no_show';
      await this.auditoria.registrar(tx, { accion: accionAud, tabla: 'reserva', registroId: id, antes: { estado: r.estado }, despues: { estado: nuevo, motivo: motivo ?? null } });
      return despues;
    });
    await this.avisos.avisar(actor.sucursalId, 'estado');
    return this.vista(res);
  }

  /**
   * Check-in de la reserva: crea la estancia con el precio pactado, pone la habitación OCUPADA y la reserva
   * EN_CURSO, todo en una transacción. La salida prevista es la de la reserva.
   */
  async checkin(actor: UsuarioSesion, id: number, datos: { procedencia?: string | null; placa?: string | null }) {
    const r = await this.prisma.reserva.findFirst({
      where: { id, sucursal_id: actor.sucursalId },
      include: { reserva_habitacion: { where: { estado: 'ACTIVA' }, include: { habitacion: { include: { estado_habitacion: true } } } } },
    });
    if (!r) throw new NotFoundException('La reserva no existe en tu sucursal');
    const ahora = new Date();
    try {
      aplicarAccion(r.estado, 'checkin', { entrada: r.fecha_entrada, salida: r.fecha_salida }, ahora);
      for (const rh of r.reserva_habitacion) {
        const desde = rh.habitacion.estado_habitacion.codigo;
        if (!esEstado(desde)) throw new ReglaReservaError('Estado de habitación desconocido');
        validarTransicion(desde, 'OCUPADA');
      }
    } catch (e) {
      traducir(e);
    }

    try {
      const res = await this.prisma.$transaction(async (tx) => {
        const estancias: bigint[] = [];
        for (const rh of r.reserva_habitacion) {
          const e = await tx.estancia.create({
            data: {
              sucursal_id: actor.sucursalId, habitacion_id: rh.habitacion_id, reserva_habitacion_id: rh.id, canal_venta_id: r.canal_venta_id,
              turno_id: rh.turno_id, checkin_at: ahora, checkout_previsto: rh.fecha_salida, cantidad_turnos: rh.cantidad_turnos,
              precio_unitario: rh.precio_unitario, procedencia: datos.procedencia?.trim() || null, placa_vehiculo: datos.placa?.trim().toUpperCase() || null,
              usuario_checkin_id: actor.sub, estancia_huesped: { create: [{ cliente_id: r.cliente_id, es_titular: true }] },
            },
          });
          estancias.push(e.id);
          await this.cambiarEstadoHabitacion(tx, rh.habitacion_id, 'OCUPADA', actor.sub, `Check-in ${r.codigo}`);
        }
        const despues = await tx.reserva.update({ where: { id }, data: { estado: 'EN_CURSO' }, select: SELECCION });
        await this.auditoria.registrar(tx, { accion: 'estancia.checkin', tabla: 'reserva', registroId: id, antes: { estado: r.estado }, despues: { estado: 'EN_CURSO', estancias: estancias.map(String) } });
        return despues;
      });
      await this.avisos.avisar(actor.sucursalId, 'estado');
      return this.vista(res);
    } catch (e) {
      traducir(e);
    }
  }

  /** Cambio de estado con historial: los triggers leen el usuario y el motivo de variables de sesión. */
  private async cambiarEstadoHabitacion(tx: Tx, habitacionId: number, codigo: string, usuarioId: number, motivo: string) {
    const estado = await tx.estado_habitacion.findUniqueOrThrow({ where: { codigo } });
    await tx.$executeRaw`SET @app_usuario_id = ${usuarioId}, @app_motivo = ${motivo}`;
    await tx.habitacion.update({ where: { id: habitacionId }, data: { estado_habitacion_id: estado.id } });
  }

  private vista(f: FilaReserva) {
    return {
      id: Number(f.id),
      codigo: f.codigo,
      estado: f.estado,
      entrada: f.fecha_entrada,
      salida: f.fecha_salida,
      adultos: f.adultos,
      ninos: f.ninos,
      total: f.monto_total.toFixed(2),
      adelanto: f.monto_adelanto.toFixed(2),
      saldo: f.monto_total.sub(f.monto_adelanto).toFixed(2),
      observaciones: f.observaciones,
      codigoExterno: f.codigo_externo,
      motivoCancelacion: f.motivo_cancelacion,
      creada: f.created_at,
      canal: { id: f.canal_venta.id, nombre: f.canal_venta.nombre, esOta: f.canal_venta.es_ota },
      cliente: {
        id: Number(f.cliente.id),
        documento: `${f.cliente.tipo_documento.abreviatura} ${f.cliente.numero_documento}`,
        nombre: f.cliente.nombre_completo ?? f.cliente.razon_social ?? '',
        telefono: f.cliente.telefono,
        pais: f.cliente.pais_codigo,
      },
      habitaciones: f.reserva_habitacion.map((rh) => ({
        id: rh.habitacion.id,
        numero: rh.habitacion.numero,
        tipo: rh.habitacion.tipo_habitacion.nombre,
        turno: rh.turno.nombre,
        horasTurno: rh.turno.duracion_horas,
        cantidad: rh.cantidad_turnos,
        precio: rh.precio_unitario.toFixed(2),
      })),
    };
  }
}
