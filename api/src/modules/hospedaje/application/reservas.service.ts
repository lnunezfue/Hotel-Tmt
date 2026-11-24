import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { AvisosTablero } from './avisos-tablero.service';
import { ContextoSucursal } from './configuracion.service';
import { bloquearHabitaciones, cruces, exigirSinCruces, traducirReglas } from './disponibilidad';
import { calcularSalidaPrevista } from '../domain/estado-habitacion';
import {
  EstadoReserva,
  normalizarMotivo,
  RESERVA_VIGENTE,
  siguienteCodigo,
  validarAnular,
  validarCantidades,
  validarConfirmar,
  validarNoShow,
} from '../domain/reserva';
import { aMinuto, esFecha, fechaDeDb, hoyLima, inicioDiaLima, sumarDias, tarifaVigente } from '../domain/tarifa';

export interface NuevaReserva {
  clienteId: number;
  canalId: number;
  entrada: string;
  turnoId: number;
  cantidadTurnos: number;
  adultos: number;
  ninos: number;
  habitacionIds: number[];
  codigoExterno?: string | null;
  observaciones?: string | null;
}

const DETALLE = {
  cliente: { select: { id: true, nombre_completo: true, numero_documento: true, tipo_documento: { select: { abreviatura: true } } } },
  canal_venta: { select: { id: true, nombre: true, es_ota: true } },
  usuario: { select: { username: true } },
  usuario_cancelacion: { select: { username: true } },
  reserva_habitacion: {
    where: { estado: 'ACTIVA' },
    orderBy: { habitacion: { numero: 'asc' } },
    include: {
      habitacion: { select: { id: true, numero: true, tipo_habitacion: { select: { nombre: true, capacidad_adultos: true, capacidad_ninos: true } } } },
      turno: { select: { id: true, nombre: true, duracion_horas: true } },
      estancia: { select: { id: true, estado: true }, orderBy: { id: 'desc' }, take: 1 },
    },
  },
} satisfies Prisma.reservaInclude;
type FilaReserva = Prisma.reservaGetPayload<{ include: typeof DETALLE }>;

function comoReserva(r: FilaReserva) {
  return {
    id: Number(r.id),
    codigo: r.codigo,
    estado: r.estado as EstadoReserva,
    titular: { id: Number(r.cliente.id), nombre: r.cliente.nombre_completo ?? '', documento: `${r.cliente.tipo_documento.abreviatura} ${r.cliente.numero_documento}` },
    canal: { id: r.canal_venta.id, nombre: r.canal_venta.nombre, esOta: r.canal_venta.es_ota },
    comisionPorcentaje: r.comision_porcentaje.toFixed(2),
    codigoExterno: r.codigo_externo,
    entrada: r.fecha_entrada,
    salida: r.fecha_salida,
    adultos: r.adultos,
    ninos: r.ninos,
    montoTotal: r.monto_total.toFixed(2),
    observaciones: r.observaciones,
    motivoCancelacion: r.motivo_cancelacion,
    canceladaPor: r.usuario_cancelacion?.username ?? null,
    canceladaEn: r.cancelada_at,
    creadaPor: r.usuario.username,
    creadaEn: r.created_at,
    habitaciones: r.reserva_habitacion.map((h) => ({
      id: Number(h.id),
      habitacionId: h.habitacion.id,
      numero: h.habitacion.numero,
      tipo: h.habitacion.tipo_habitacion.nombre,
      capacidad: h.habitacion.tipo_habitacion.capacidad_adultos + h.habitacion.tipo_habitacion.capacidad_ninos,
      turno: { id: h.turno.id, nombre: h.turno.nombre, horas: h.turno.duracion_horas },
      cantidadTurnos: h.cantidad_turnos,
      precioUnitario: h.precio_unitario.toFixed(2),
      subtotal: (h.subtotal ?? h.precio_unitario.mul(h.cantidad_turnos)).toFixed(2),
      estancia: h.estancia[0] ? { id: Number(h.estancia[0].id), estado: h.estancia[0].estado } : null,
    })),
  };
}

/** Reservas de la sucursal del token (RF-RES-06, RF-RES-16, RF-RES-18; spec S-06). */
@Injectable()
export class ReservasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly avisos: AvisosTablero,
  ) {}

  /** Precio de la tarifa que rige para tipo × canal × turno en una fecha de Lima, o null si no hay. */
  async precioVigente(sucursalId: number, tipoId: number, canalId: number, turnoId: number, fecha: string) {
    const filas = await this.prisma.tarifa.findMany({
      where: { sucursal_id: sucursalId, tipo_habitacion_id: tipoId, canal_venta_id: canalId, turno_id: turnoId },
    });
    const v = tarifaVigente(
      filas.map((f) => ({ id: f.id, desde: fechaDeDb(f.vigente_desde), hasta: f.vigente_hasta ? fechaDeDb(f.vigente_hasta) : null, activo: f.activo })),
      fecha,
    );
    return v ? filas.find((f) => f.id === v.id)! : null;
  }

  /** Habitaciones libres para un horario, con el precio que tendría cada una. */
  async disponibles(c: ContextoSucursal, q: { entrada: string; turnoId: number; cantidad: number; canalId: number }) {
    const entrada = aMinuto(new Date(q.entrada));
    const turno = await this.prisma.turno.findFirst({ where: { id: q.turnoId, activo: true } });
    if (!turno) throw new BadRequestException('El turno no existe o está inactivo');
    try {
      validarCantidades({ cantidadTurnos: q.cantidad, adultos: 1, ninos: 0 });
    } catch (e) {
      traducirReglas(e);
    }
    const salida = calcularSalidaPrevista(entrada, turno.duracion_horas, q.cantidad);
    const habitaciones = await this.prisma.habitacion.findMany({
      where: { sucursal_id: c.sucursalId, activo: true, piso: { activo: true } },
      include: { tipo_habitacion: true, piso: { select: { nombre: true, numero: true } }, estado_habitacion: { select: { codigo: true } } },
      orderBy: [{ piso: { numero: 'asc' } }, { numero: 'asc' }],
    });
    const tomadas = new Set((await cruces(this.prisma, habitaciones.map((h) => h.id), entrada, salida)).map((x) => x.habitacionId));
    const fecha = hoyLima(entrada);
    const precios = new Map<number, string | null>();
    for (const tipoId of new Set(habitaciones.map((h) => h.tipo_habitacion_id))) {
      const t = await this.precioVigente(c.sucursalId, tipoId, q.canalId, q.turnoId, fecha);
      precios.set(tipoId, t ? t.precio.toFixed(2) : null);
    }
    return {
      entrada,
      salida,
      habitaciones: habitaciones
        .filter((h) => !tomadas.has(h.id))
        .map((h) => ({
          id: h.id,
          numero: h.numero,
          piso: h.piso.nombre,
          tipo: h.tipo_habitacion.nombre,
          capacidad: h.tipo_habitacion.capacidad_adultos + h.tipo_habitacion.capacidad_ninos,
          estado: h.estado_habitacion.codigo,
          precio: precios.get(h.tipo_habitacion_id) ?? null,
        })),
    };
  }

  /** Habitaciones × días con las reservas por llegar y las estancias, para el calendario. */
  async calendario(c: ContextoSucursal, desde: string | undefined, dias: number) {
    const dia = desde ?? hoyLima();
    if (!esFecha(dia)) throw new BadRequestException('Fecha no válida; usa AAAA-MM-DD');
    const inicio = inicioDiaLima(dia);
    const fin = inicioDiaLima(sumarDias(dia, dias));
    const [habitaciones, reservas, estancias] = await Promise.all([
      this.prisma.habitacion.findMany({
        where: { sucursal_id: c.sucursalId, activo: true },
        include: { tipo_habitacion: { select: { nombre: true } }, piso: { select: { numero: true, nombre: true } } },
        orderBy: [{ piso: { numero: 'asc' } }, { numero: 'asc' }],
      }),
      this.prisma.reserva_habitacion.findMany({
        where: {
          estado: 'ACTIVA',
          estancia: { none: {} },
          reserva: { sucursal_id: c.sucursalId, estado: { in: ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'] } },
          fecha_entrada: { lt: fin },
          fecha_salida: { gt: inicio },
        },
        include: { reserva: { select: { id: true, codigo: true, estado: true, cliente: { select: { nombre_completo: true } }, canal_venta: { select: { nombre: true } } } } },
      }),
      this.prisma.estancia.findMany({
        where: {
          sucursal_id: c.sucursalId,
          estado: { in: ['ACTIVA', 'FINALIZADA'] },
          checkin_at: { lt: fin },
          OR: [{ checkout_at: { gt: inicio } }, { checkout_at: null, checkout_previsto: { gt: inicio } }, { estado: 'ACTIVA' }],
        },
        include: {
          estancia_huesped: { where: { es_titular: true }, select: { cliente: { select: { nombre_completo: true } } } },
          reserva_habitacion: { select: { reserva: { select: { id: true, codigo: true } } } },
          canal_venta: { select: { nombre: true } },
        },
      }),
    ]);
    const ahora = new Date();
    return {
      desde: dia,
      dias,
      habitaciones: habitaciones.map((h) => ({ id: h.id, numero: h.numero, tipo: h.tipo_habitacion.nombre, piso: h.piso.nombre })),
      bloques: [
        ...reservas.map((r) => ({
          tipo: 'reserva' as const,
          habitacionId: r.habitacion_id,
          inicio: r.fecha_entrada,
          fin: r.fecha_salida,
          titular: r.reserva.cliente.nombre_completo ?? '',
          canal: r.reserva.canal_venta.nombre,
          estado: r.reserva.estado,
          reservaId: Number(r.reserva.id),
          codigo: r.reserva.codigo,
          estanciaId: null,
        })),
        ...estancias.map((e) => {
          const salida = e.checkout_at ?? (e.checkout_previsto < ahora && e.estado === 'ACTIVA' ? ahora : e.checkout_previsto);
          return {
            tipo: 'estancia' as const,
            habitacionId: e.habitacion_id,
            inicio: e.checkin_at,
            fin: salida,
            titular: e.estancia_huesped[0]?.cliente.nombre_completo ?? '',
            canal: e.canal_venta.nombre,
            estado: e.estado,
            reservaId: e.reserva_habitacion ? Number(e.reserva_habitacion.reserva.id) : null,
            codigo: e.reserva_habitacion?.reserva.codigo ?? null,
            estanciaId: Number(e.id),
          };
        }),
      ],
    };
  }

  async obtener(c: ContextoSucursal, id: number) {
    const r = await this.prisma.reserva.findFirst({ where: { id, sucursal_id: c.sucursalId }, include: DETALLE });
    if (!r) throw new NotFoundException('La reserva no existe en tu sucursal');
    return comoReserva(r);
  }

  async crear(c: ContextoSucursal, usuarioId: number, d: NuevaReserva) {
    const entrada = aMinuto(new Date(d.entrada));
    try {
      validarCantidades(d);
    } catch (e) {
      traducirReglas(e);
    }
    const ids = [...new Set(d.habitacionIds)];
    if (ids.length !== d.habitacionIds.length) throw new BadRequestException('Una habitación aparece más de una vez');
    if (hoyLima(entrada) < hoyLima()) throw new BadRequestException('La entrada no puede ser en una fecha pasada');

    const [cliente, canal, turno, habitaciones, pen] = await Promise.all([
      this.prisma.cliente.findFirst({ where: { id: d.clienteId, empresa_id: c.empresaId } }),
      this.prisma.canal_venta.findFirst({ where: { id: d.canalId, empresa_id: c.empresaId, activo: true } }),
      this.prisma.turno.findFirst({ where: { id: d.turnoId, activo: true } }),
      this.prisma.habitacion.findMany({ where: { id: { in: ids }, sucursal_id: c.sucursalId, activo: true }, include: { tipo_habitacion: true } }),
      this.prisma.moneda.findUniqueOrThrow({ where: { codigo_iso: 'PEN' } }),
    ]);
    if (!cliente) throw new BadRequestException('El titular no existe');
    if (!cliente.activo) throw new BadRequestException('El titular está desactivado');
    if (!canal) throw new BadRequestException('El canal de venta no existe o está inactivo');
    if (!turno) throw new BadRequestException('El turno no existe o está inactivo');
    if (habitaciones.length !== ids.length) throw new BadRequestException('Alguna habitación no existe o está inactiva en tu sucursal');
    const capacidad = habitaciones.reduce((s, h) => s + h.tipo_habitacion.capacidad_adultos + h.tipo_habitacion.capacidad_ninos, 0);
    if (d.adultos + d.ninos > capacidad) throw new BadRequestException(`Las habitaciones elegidas admiten ${capacidad} personas y la reserva es para ${d.adultos + d.ninos}`);
    const codigoExterno = d.codigoExterno?.trim() || null;
    if (codigoExterno && codigoExterno.length > 50) throw new BadRequestException('El código externo admite hasta 50 caracteres');
    const observaciones = d.observaciones?.trim() || null;
    if (observaciones && observaciones.length > 500) throw new BadRequestException('Las observaciones admiten hasta 500 caracteres');

    const salida = calcularSalidaPrevista(entrada, turno.duracion_horas, d.cantidadTurnos);
    const fecha = hoyLima(entrada);
    const precios = new Map<number, { id: number; precio: Prisma.Decimal }>();
    for (const h of habitaciones) {
      if (precios.has(h.tipo_habitacion_id)) continue;
      const t = await this.precioVigente(c.sucursalId, h.tipo_habitacion_id, canal.id, turno.id, fecha);
      if (!t) throw new ConflictException(`No hay tarifa vigente el ${fecha} para ${h.tipo_habitacion.nombre} · ${canal.nombre} · ${turno.nombre}`);
      precios.set(h.tipo_habitacion_id, { id: t.id, precio: t.precio });
    }
    const total = habitaciones.reduce((s, h) => s.add(precios.get(h.tipo_habitacion_id)!.precio.mul(d.cantidadTurnos)), new Prisma.Decimal(0));

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        // La sucursal serializa la numeración; las habitaciones, a quien reserve o haga el check-in a la vez.
        await tx.$queryRaw`SELECT id FROM sucursal WHERE id = ${c.sucursalId} FOR UPDATE`;
        await bloquearHabitaciones(tx, ids);
        await exigirSinCruces(tx, ids, entrada, salida);
        const anio = Number(hoyLima().slice(0, 4));
        const ultima = await tx.reserva.findFirst({
          where: { sucursal_id: c.sucursalId, codigo: { startsWith: `R-${anio}-` } },
          orderBy: { codigo: 'desc' },
          select: { codigo: true },
        });
        const reserva = await tx.reserva.create({
          data: {
            sucursal_id: c.sucursalId,
            codigo: siguienteCodigo(anio, ultima?.codigo ?? null),
            cliente_id: cliente.id,
            canal_venta_id: canal.id,
            comision_porcentaje: canal.comision_porcentaje,
            codigo_externo: codigoExterno,
            fecha_entrada: entrada,
            fecha_salida: salida,
            adultos: d.adultos,
            ninos: d.ninos,
            moneda_id: pen.id,
            monto_total: total,
            observaciones,
            usuario_id: usuarioId,
            reserva_habitacion: {
              create: habitaciones.map((h) => ({
                habitacion_id: h.id,
                tarifa_id: precios.get(h.tipo_habitacion_id)!.id,
                turno_id: turno.id,
                fecha_entrada: entrada,
                fecha_salida: salida,
                cantidad_turnos: d.cantidadTurnos,
                precio_unitario: precios.get(h.tipo_habitacion_id)!.precio,
              })),
            },
          },
          include: { reserva_habitacion: true },
        });
        await this.auditoria.registrar(tx, { accion: 'reserva.crear', tabla: 'reserva', registroId: reserva.id, despues: reserva });
        return reserva.id;
      });
      await this.avisos.avisar(c.sucursalId, 'reserva');
      return this.obtener(c, Number(id));
    } catch (e) {
      if (e instanceof ConflictException || e instanceof BadRequestException) throw e;
      traducirReglas(e);
    }
  }

  confirmar(c: ContextoSucursal, id: number) {
    return this.cambiar(c, id, 'reserva.confirmar', (r) => {
      validarConfirmar(r.estado);
      return { estado: 'CONFIRMADA' };
    });
  }

  anular(c: ContextoSucursal, usuarioId: number, id: number, motivo: string) {
    return this.cambiar(c, id, 'reserva.anular', (r) => {
      validarAnular(r.estado);
      return { estado: 'CANCELADA', motivo_cancelacion: normalizarMotivo(motivo), usuario_cancelacion_id: usuarioId, cancelada_at: new Date() };
    });
  }

  noShow(c: ContextoSucursal, usuarioId: number, id: number, motivo: string) {
    return this.cambiar(c, id, 'reserva.no_show', (r) => {
      validarNoShow(r.estado, r.fecha_entrada, new Date());
      return { estado: 'NO_SHOW', motivo_cancelacion: normalizarMotivo(motivo), usuario_cancelacion_id: usuarioId, cancelada_at: new Date() };
    });
  }

  /** Cambio de estado con la reserva bloqueada: dos recepcionistas no pueden confirmar y anular a la vez. */
  private async cambiar(
    c: ContextoSucursal,
    id: number,
    accion: 'reserva.confirmar' | 'reserva.anular' | 'reserva.no_show',
    regla: (r: { estado: EstadoReserva; fecha_entrada: Date }) => Prisma.reservaUncheckedUpdateInput,
  ) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const filas = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM reserva WHERE id = ${id} AND sucursal_id = ${c.sucursalId} FOR UPDATE`;
        if (filas.length === 0) throw new NotFoundException('La reserva no existe en tu sucursal');
        const antes = await tx.reserva.findUniqueOrThrow({ where: { id } });
        const despues = await tx.reserva.update({ where: { id }, data: regla({ estado: antes.estado as EstadoReserva, fecha_entrada: antes.fecha_entrada }) });
        await this.auditoria.registrar(tx, { accion, tabla: 'reserva', registroId: id, antes, despues });
      });
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      traducirReglas(e);
    }
    await this.avisos.avisar(c.sucursalId, 'reserva');
    return this.obtener(c, id);
  }

  /** Llegadas de hoy por habitación, para el tablero. */
  async llegadasDeHoy(sucursalId: number) {
    const hoy = hoyLima();
    const filas = await this.prisma.reserva_habitacion.findMany({
      where: {
        estado: 'ACTIVA',
        estancia: { none: {} },
        reserva: { sucursal_id: sucursalId, estado: { in: RESERVA_VIGENTE } },
        fecha_entrada: { gte: inicioDiaLima(hoy), lt: inicioDiaLima(sumarDias(hoy, 1)) },
      },
      orderBy: { fecha_entrada: 'asc' },
      include: { reserva: { select: { id: true, codigo: true, estado: true, cliente: { select: { nombre_completo: true } } } } },
    });
    const porHabitacion = new Map<number, { reservaId: number; reservaHabitacionId: number; codigo: string; estado: string; titular: string; entrada: Date }>();
    for (const f of filas) {
      if (porHabitacion.has(f.habitacion_id)) continue;
      porHabitacion.set(f.habitacion_id, {
        reservaId: Number(f.reserva.id),
        reservaHabitacionId: Number(f.id),
        codigo: f.reserva.codigo,
        estado: f.reserva.estado,
        titular: f.reserva.cliente.nombre_completo ?? '',
        entrada: f.fecha_entrada,
      });
    }
    return porHabitacion;
  }
}
