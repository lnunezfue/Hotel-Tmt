import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { AvisosTablero } from './avisos-tablero.service';
import { ContextoSucursal } from './configuracion.service';
import { ReservasService } from './reservas.service';
import { bloquearHabitaciones, exigirSinCruces, traducirReglas } from './disponibilidad';
import { esPersona, CodigoDocumento } from '../domain/cliente';
import { calcularSalidaPrevista, EstadoHabitacion } from '../domain/estado-habitacion';
import { DatosLibro, EstadoEstanciaError, liquidar, normalizarDatosLibro, validarExtension, validarHuespedes } from '../domain/estancia';
import { EstadoReserva, validarCantidades, validarCheckinDeReserva } from '../domain/reserva';
import { aSegundo, esFecha, hoyLima, inicioDiaLima, sumarDias } from '../domain/tarifa';

export type NuevoCheckin = DatosLibro & {
  titularId: number;
  acompanantes: number[];
} & ({ reservaHabitacionId: number } | { habitacionId: number; canalId: number; turnoId: number; cantidadTurnos: number });

/** Estados desde los que una habitación recibe huéspedes. */
const ADMITE_CHECKIN: EstadoHabitacion[] = ['DESOCUPADA', 'RESERVADA', 'CONFIRMADA'];

const DETALLE = {
  habitacion: { select: { id: true, numero: true, tipo_habitacion: { select: { nombre: true } } } },
  turno: { select: { id: true, nombre: true, duracion_horas: true } },
  canal_venta: { select: { id: true, nombre: true } },
  usuario_checkin: { select: { username: true } },
  usuario_checkout: { select: { username: true } },
  reserva_habitacion: { select: { reserva: { select: { id: true, codigo: true } } } },
  estancia_huesped: {
    orderBy: { es_titular: 'desc' },
    select: { es_titular: true, cliente: { select: { id: true, nombre_completo: true, numero_documento: true, pais_codigo: true, tipo_documento: { select: { abreviatura: true } } } } },
  },
} satisfies Prisma.estanciaInclude;
type FilaEstancia = Prisma.estanciaGetPayload<{ include: typeof DETALLE }>;

const centimos = (d: Prisma.Decimal) => Math.round(Number(d.toFixed(2)) * 100);
const soles = (c: number) => (c / 100).toFixed(2);

function liquidacionDe(e: { checkin_at: Date; cantidad_turnos: number; precio_unitario: Prisma.Decimal; turno: { duracion_horas: number } }, salida: Date) {
  const l = liquidar({ checkin: e.checkin_at, salida, horasTurno: e.turno.duracion_horas, contratados: e.cantidad_turnos, precioCentimos: centimos(e.precio_unitario) });
  return { salida, contratados: l.contratados, consumidos: l.consumidos, adicionales: l.adicionales, precioUnitario: e.precio_unitario.toFixed(2), importe: soles(l.importeCentimos) };
}

function comoEstancia(e: FilaEstancia, ahora: Date) {
  return {
    id: Number(e.id),
    estado: e.estado,
    habitacion: { id: e.habitacion.id, numero: e.habitacion.numero, tipo: e.habitacion.tipo_habitacion.nombre },
    reserva: e.reserva_habitacion ? { id: Number(e.reserva_habitacion.reserva.id), codigo: e.reserva_habitacion.reserva.codigo } : null,
    canal: e.canal_venta,
    comisionPorcentaje: e.comision_porcentaje.toFixed(2),
    turno: { id: e.turno.id, nombre: e.turno.nombre, horas: e.turno.duracion_horas },
    cantidadTurnos: e.cantidad_turnos,
    precioUnitario: e.precio_unitario.toFixed(2),
    montoHospedaje: (e.monto_hospedaje ?? e.precio_unitario.mul(e.cantidad_turnos)).toFixed(2),
    checkin: e.checkin_at,
    salidaPrevista: e.checkout_previsto,
    salida: e.checkout_at,
    procedencia: e.procedencia,
    destino: e.destino,
    motivoViaje: e.motivo_viaje,
    placaVehiculo: e.placa_vehiculo,
    ingresoPor: e.usuario_checkin.username,
    salidaPor: e.usuario_checkout?.username ?? null,
    huespedes: e.estancia_huesped.map((h) => ({
      id: Number(h.cliente.id),
      nombre: h.cliente.nombre_completo ?? '',
      documento: `${h.cliente.tipo_documento.abreviatura} ${h.cliente.numero_documento}`,
      paisCodigo: h.cliente.pais_codigo,
      titular: h.es_titular,
    })),
    liquidacion: e.estado === 'ACTIVA' ? liquidacionDe(e, ahora) : null,
  };
}

/** Check-in, extensión y check-out de la sucursal del token (RF-RES-10 a 13; spec S-06). */
@Injectable()
export class EstanciasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly avisos: AvisosTablero,
    private readonly reservas: ReservasService,
  ) {}

  async obtener(c: ContextoSucursal, id: number) {
    const e = await this.prisma.estancia.findFirst({ where: { id, sucursal_id: c.sucursalId }, include: DETALLE });
    if (!e) throw new NotFoundException('La estancia no existe en tu sucursal');
    return comoEstancia(e, new Date());
  }

  async liquidacion(c: ContextoSucursal, id: number) {
    const e = await this.prisma.estancia.findFirst({ where: { id, sucursal_id: c.sucursalId }, include: { turno: true } });
    if (!e) throw new NotFoundException('La estancia no existe en tu sucursal');
    if (e.estado !== 'ACTIVA') throw new ConflictException('La estancia ya terminó');
    return liquidacionDe(e, new Date());
  }

  async checkin(c: ContextoSucursal, usuarioId: number, d: NuevoCheckin) {
    const ahora = aSegundo(new Date());
    let libro: ReturnType<typeof normalizarDatosLibro>;
    try {
      libro = normalizarDatosLibro(d);
    } catch (e) {
      traducirReglas(e);
    }

    // Origen: la habitación de una reserva o un walk-in. De ahí salen habitación, turno, precio, canal y comisión.
    let origen: { habitacionId: number; turnoId: number; horas: number; cantidad: number; precio: Prisma.Decimal; canalId: number; comision: Prisma.Decimal; reservaHabitacionId: bigint | null; reservaId: bigint | null };
    if ('reservaHabitacionId' in d) {
      const rh = await this.prisma.reserva_habitacion.findFirst({
        where: { id: d.reservaHabitacionId, reserva: { sucursal_id: c.sucursalId } },
        include: { reserva: true, turno: true, estancia: { select: { id: true } } },
      });
      if (!rh) throw new NotFoundException('La habitación de la reserva no existe en tu sucursal');
      try {
        validarCheckinDeReserva(rh.reserva.estado as EstadoReserva);
      } catch (e) {
        traducirReglas(e);
      }
      if (rh.estado !== 'ACTIVA') throw new ConflictException('Esa habitación se quitó de la reserva');
      if (rh.estancia.length > 0) throw new ConflictException('Esa habitación de la reserva ya hizo su check-in');
      if (hoyLima(ahora) < hoyLima(rh.fecha_entrada)) {
        throw new ConflictException(`La reserva es para el ${hoyLima(rh.fecha_entrada).split('-').reverse().join('/')}; aún no se puede hacer el check-in`);
      }
      if (ahora >= rh.fecha_salida) throw new ConflictException('La reserva ya venció; márcala como no presentada y registra un walk-in');
      origen = {
        habitacionId: rh.habitacion_id,
        turnoId: rh.turno_id,
        horas: rh.turno.duracion_horas,
        cantidad: rh.cantidad_turnos,
        precio: rh.precio_unitario,
        canalId: rh.reserva.canal_venta_id,
        comision: rh.reserva.comision_porcentaje,
        reservaHabitacionId: rh.id,
        reservaId: rh.reserva.id,
      };
    } else {
      try {
        validarCantidades({ cantidadTurnos: d.cantidadTurnos, adultos: 1, ninos: 0 });
      } catch (e) {
        traducirReglas(e);
      }
      const [hab, canal, turno] = await Promise.all([
        this.prisma.habitacion.findFirst({ where: { id: d.habitacionId, sucursal_id: c.sucursalId, activo: true }, include: { tipo_habitacion: true } }),
        this.prisma.canal_venta.findFirst({ where: { id: d.canalId, empresa_id: c.empresaId, activo: true } }),
        this.prisma.turno.findFirst({ where: { id: d.turnoId, activo: true } }),
      ]);
      if (!hab) throw new BadRequestException('La habitación no existe o está inactiva en tu sucursal');
      if (!canal) throw new BadRequestException('El canal de venta no existe o está inactivo');
      if (!turno) throw new BadRequestException('El turno no existe o está inactivo');
      const tarifa = await this.reservas.precioVigente(c.sucursalId, hab.tipo_habitacion_id, canal.id, turno.id, hoyLima(ahora));
      if (!tarifa) throw new ConflictException(`No hay tarifa vigente hoy para ${hab.tipo_habitacion.nombre} · ${canal.nombre} · ${turno.nombre}`);
      origen = {
        habitacionId: hab.id,
        turnoId: turno.id,
        horas: turno.duracion_horas,
        cantidad: d.cantidadTurnos,
        precio: tarifa.precio,
        canalId: canal.id,
        comision: canal.comision_porcentaje,
        reservaHabitacionId: null,
        reservaId: null,
      };
    }

    const hab = await this.prisma.habitacion.findFirstOrThrow({ where: { id: origen.habitacionId }, include: { tipo_habitacion: true } });
    const titular = BigInt(d.titularId);
    const acompanantes = d.acompanantes.map((x) => BigInt(x));
    try {
      validarHuespedes(titular, acompanantes, hab.tipo_habitacion.capacidad_adultos + hab.tipo_habitacion.capacidad_ninos);
    } catch (e) {
      traducirReglas(e);
    }
    const ids = [titular, ...acompanantes];
    const clientes = await this.prisma.cliente.findMany({ where: { id: { in: ids }, empresa_id: c.empresaId }, include: { tipo_documento: true } });
    if (clientes.length !== ids.length) throw new BadRequestException('Algún huésped no existe');
    for (const cl of clientes) {
      if (!cl.activo) throw new BadRequestException(`${cl.nombre_completo} está desactivado`);
      if (!esPersona(cl.tipo_documento.codigo_sunat as CodigoDocumento)) {
        throw new BadRequestException(`${cl.nombre_completo} no puede alojarse: un huésped se identifica con DNI, carnet de extranjería, pasaporte o cédula`);
      }
    }

    const salida = calcularSalidaPrevista(ahora, origen.horas, origen.cantidad);
    const ocupada = await this.prisma.estado_habitacion.findUniqueOrThrow({ where: { codigo: 'OCUPADA' } });
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        await bloquearHabitaciones(tx, [hab.id]);
        const actual = await tx.habitacion.findUniqueOrThrow({ where: { id: hab.id }, include: { estado_habitacion: true } });
        const estado = actual.estado_habitacion.codigo as EstadoHabitacion;
        if (!ADMITE_CHECKIN.includes(estado)) throw new EstadoEstanciaError(`La habitación ${hab.numero} está ${actual.estado_habitacion.descripcion.toLowerCase()}; no recibe huéspedes`);
        await exigirSinCruces(tx, [hab.id], ahora, salida, origen.reservaHabitacionId !== null ? { reservaHabitacionId: origen.reservaHabitacionId } : {}, ahora);
        const alojado = await tx.estancia_huesped.findFirst({
          where: { cliente_id: { in: ids }, estancia: { estado: 'ACTIVA' } },
          include: { cliente: { select: { nombre_completo: true } }, estancia: { select: { habitacion: { select: { numero: true } } } } },
        });
        if (alojado) throw new ConflictException(`${alojado.cliente.nombre_completo} ya está alojado en la habitación ${alojado.estancia.habitacion.numero}`);
        if (origen.reservaHabitacionId !== null) {
          // Dos check-in simultáneos de la misma habitación de reserva: el bloqueo de la habitación los ordena.
          if (await tx.estancia.count({ where: { reserva_habitacion_id: origen.reservaHabitacionId } })) {
            throw new ConflictException('Esa habitación de la reserva ya hizo su check-in');
          }
        }
        const estancia = await tx.estancia.create({
          data: {
            sucursal_id: c.sucursalId,
            habitacion_id: hab.id,
            reserva_habitacion_id: origen.reservaHabitacionId,
            canal_venta_id: origen.canalId,
            comision_porcentaje: origen.comision,
            turno_id: origen.turnoId,
            checkin_at: ahora,
            checkout_previsto: salida,
            cantidad_turnos: origen.cantidad,
            precio_unitario: origen.precio,
            procedencia: libro.procedencia,
            destino: libro.destino,
            motivo_viaje: libro.motivoViaje,
            placa_vehiculo: libro.placaVehiculo,
            usuario_checkin_id: usuarioId,
            estancia_huesped: { create: ids.map((cliente_id, i) => ({ cliente_id, es_titular: i === 0 })) },
          },
        });
        await tx.$executeRaw`SET @app_usuario_id = ${usuarioId}, @app_motivo = ${`Check-in E-${estancia.id}`}`;
        await tx.habitacion.update({ where: { id: hab.id }, data: { estado_habitacion_id: ocupada.id } });
        if (origen.reservaId !== null) await tx.reserva.update({ where: { id: origen.reservaId }, data: { estado: 'EN_CURSO' } });
        await this.auditoria.registrar(tx, { accion: 'estancia.checkin', tabla: 'estancia', registroId: estancia.id, despues: { ...estancia, huespedes: ids } });
        return estancia.id;
      });
      await this.avisos.avisar(c.sucursalId, 'estado');
      return this.obtener(c, Number(id));
    } catch (e) {
      if (e instanceof ConflictException || e instanceof BadRequestException || e instanceof NotFoundException) throw e;
      traducirReglas(e);
    }
  }

  async extender(c: ContextoSucursal, id: number, turnos: number) {
    try {
      validarExtension(turnos);
      await this.prisma.$transaction(async (tx) => {
        const previa = await tx.estancia.findFirst({ where: { id, sucursal_id: c.sucursalId }, select: { habitacion_id: true } });
        if (!previa) throw new NotFoundException('La estancia no existe en tu sucursal');
        await bloquearHabitaciones(tx, [previa.habitacion_id]);
        const antes = await tx.estancia.findUniqueOrThrow({ where: { id }, include: { turno: true } });
        if (antes.estado !== 'ACTIVA') throw new EstadoEstanciaError('Solo se extiende una estancia en curso');
        const nueva = new Date(antes.checkout_previsto.getTime() + antes.turno.duracion_horas * turnos * 3_600_000);
        await exigirSinCruces(tx, [antes.habitacion_id], antes.checkout_previsto, nueva, { estanciaId: antes.id });
        const despues = await tx.estancia.update({ where: { id }, data: { cantidad_turnos: antes.cantidad_turnos + turnos, checkout_previsto: nueva } });
        const { turno: _t, ...datosAntes } = antes;
        await this.auditoria.registrar(tx, { accion: 'estancia.extender', tabla: 'estancia', registroId: id, antes: datosAntes, despues: { ...despues, turnosAgregados: turnos } });
      });
    } catch (e) {
      if (e instanceof ConflictException || e instanceof NotFoundException) throw e;
      traducirReglas(e);
    }
    await this.avisos.avisar(c.sucursalId, 'estado');
    return this.obtener(c, id);
  }

  async checkout(c: ContextoSucursal, usuarioId: number, id: number) {
    const ahora = aSegundo(new Date());
    let liquidacion: ReturnType<typeof liquidacionDe>;
    try {
      const [ocupada, limpieza] = await Promise.all([
        this.prisma.estado_habitacion.findUniqueOrThrow({ where: { codigo: 'OCUPADA' } }),
        this.prisma.estado_habitacion.findUniqueOrThrow({ where: { codigo: 'LIMPIEZA' } }),
      ]);
      liquidacion = await this.prisma.$transaction(async (tx) => {
        const previa = await tx.estancia.findFirst({ where: { id, sucursal_id: c.sucursalId }, select: { habitacion_id: true } });
        if (!previa) throw new NotFoundException('La estancia no existe en tu sucursal');
        await bloquearHabitaciones(tx, [previa.habitacion_id]);
        const antes = await tx.estancia.findUniqueOrThrow({ where: { id }, include: { turno: true } });
        if (antes.estado !== 'ACTIVA') throw new EstadoEstanciaError('La estancia ya terminó');
        const l = liquidacionDe(antes, ahora);
        const despues = await tx.estancia.update({
          where: { id },
          data: {
            estado: 'FINALIZADA',
            checkout_at: ahora,
            usuario_checkout_id: usuarioId,
            cantidad_turnos: l.consumidos,
            checkout_previsto: calcularSalidaPrevista(antes.checkin_at, antes.turno.duracion_horas, l.consumidos),
          },
        });
        const hab = await tx.habitacion.findUniqueOrThrow({ where: { id: antes.habitacion_id } });
        if (hab.estado_habitacion_id === ocupada.id) {
          await tx.$executeRaw`SET @app_usuario_id = ${usuarioId}, @app_motivo = ${`Check-out E-${id}`}`;
          await tx.habitacion.update({ where: { id: hab.id }, data: { estado_habitacion_id: limpieza.id } });
        }
        if (antes.reserva_habitacion_id !== null) await this.cerrarReservaSiTermino(tx, antes.reserva_habitacion_id);
        const { turno: _t, ...datosAntes } = antes;
        await this.auditoria.registrar(tx, { accion: 'estancia.checkout', tabla: 'estancia', registroId: id, antes: datosAntes, despues: { ...despues, liquidacion: l } });
        return l;
      });
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      traducirReglas(e);
    }
    await this.avisos.avisar(c.sucursalId, 'estado');
    return { estancia: await this.obtener(c, id), liquidacion };
  }

  /** La reserva termina cuando todas sus habitaciones activas ya salieron. */
  private async cerrarReservaSiTermino(tx: Prisma.TransactionClient, reservaHabitacionId: bigint) {
    const rh = await tx.reserva_habitacion.findUniqueOrThrow({ where: { id: reservaHabitacionId }, select: { reserva_id: true } });
    const habitaciones = await tx.reserva_habitacion.findMany({
      where: { reserva_id: rh.reserva_id, estado: 'ACTIVA' },
      select: { estancia: { select: { estado: true } } },
    });
    const terminaron = habitaciones.every((h) => h.estancia.length > 0 && h.estancia.every((e) => e.estado !== 'ACTIVA'));
    if (terminaron) await tx.reserva.update({ where: { id: rh.reserva_id }, data: { estado: 'FINALIZADA' } });
  }

  /** Libro de registro de huéspedes (RF-RES-11) por fecha de ingreso, desde la vista `vw_libro_huespedes`. */
  async libro(c: ContextoSucursal, desde: string, hasta: string) {
    if (!esFecha(desde) || !esFecha(hasta)) throw new BadRequestException('Fecha no válida; usa AAAA-MM-DD');
    if (hasta < desde) throw new BadRequestException('La fecha final es anterior a la inicial');
    if (sumarDias(desde, 31) <= hasta) throw new BadRequestException('El rango admite hasta 31 días');
    const filas = await this.prisma.$queryRaw<
      Array<{
        estancia_id: bigint; fecha_entrada: Date; fecha_salida: Date | null; habitacion: string; huesped: string; tipo_doc: string;
        numero_documento: string; nacionalidad: string; fecha_nacimiento: Date | null; sexo: string | null; procedencia: string | null;
        destino: string | null; motivo_viaje: string | null; es_titular: number | boolean;
      }>
    >`SELECT * FROM vw_libro_huespedes
       WHERE sucursal_id = ${c.sucursalId} AND fecha_entrada >= ${inicioDiaLima(desde)} AND fecha_entrada < ${inicioDiaLima(sumarDias(hasta, 1))}
       ORDER BY fecha_entrada, estancia_id, es_titular DESC`;
    return filas.map((f) => ({
      estanciaId: Number(f.estancia_id),
      entrada: f.fecha_entrada,
      salida: f.fecha_salida,
      habitacion: f.habitacion,
      huesped: f.huesped,
      documento: `${f.tipo_doc} ${f.numero_documento}`,
      nacionalidad: f.nacionalidad,
      fechaNacimiento: f.fecha_nacimiento ? f.fecha_nacimiento.toISOString().slice(0, 10) : null,
      sexo: f.sexo,
      procedencia: f.procedencia,
      destino: f.destino,
      motivoViaje: f.motivo_viaje,
      titular: Boolean(Number(f.es_titular)),
    }));
  }
}
