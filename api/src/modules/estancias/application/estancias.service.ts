import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsuarioSesion } from '../../../common/usuario-actual.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { CajaService } from '../../caja/application/caja.service';
import { AvisosTablero } from '../../hospedaje/application/avisos-tablero.service';
import { ConfiguracionService } from '../../hospedaje/application/configuracion.service';
import { esEstado, TransicionInvalidaError, validarTransicion } from '../../hospedaje/domain/estado-habitacion';
import { hoyLima } from '../../hospedaje/domain/tarifa';
import { rangoPorHoras, rangoPorNoches, ReglaReservaError, validarHuespedes } from '../../reservas/domain/reserva';
import { aCentimos, aSoles, comision, desglosarIgv, LineaCuenta, montoEnLetras, ReglaCobroError, repartirPagos, totalesComprobante } from '../domain/cobro';
import { normalizarLibro, normalizarMotivoTraslado, ReglaEstadiaError, salidaExtendida, turnosAdicionales, validarExtension } from '../domain/estadia';
import { bloquearHabitaciones, exigirNoAlojados, exigirSinCruces } from '../../hospedaje/application/cruces';
import { esFecha, inicioDiaLima, sumarDias } from '../../hospedaje/domain/tarifa';

type Tx = Prisma.TransactionClient;

export interface CheckinDirecto {
  habitacionId: number;
  clienteId: number;
  acompanantes?: number[];
  canalId: number;
  turnoId: number;
  cantidad: number;
  procedencia?: string | null;
  placa?: string | null;
  destino?: string | null;
  motivoViaje?: string | null;
}

export interface Checkout {
  tipoComprobante: 'BOLETA' | 'FACTURA' | 'INTERNO';
  clienteId?: number;
  pagos: Array<{ metodoPagoId: number; monto: number; referencia?: string | null }>;
}

function traducir(e: unknown): never {
  if (e instanceof ReglaReservaError || e instanceof ReglaCobroError || e instanceof ReglaEstadiaError) throw new BadRequestException(e.message);
  if (e instanceof TransicionInvalidaError) throw new ConflictException(`La habitación no está lista: ${e.message}`);
  const texto = e instanceof Error ? e.message : '';
  const m = /(La habitación está ocupada[^"'\n]*|La factura requiere cliente con RUC|Serie inactiva|Serie inexistente)/.exec(texto);
  if (m) throw new ConflictException(m[1].trim());
  throw e;
}

const INCLUIR = {
  habitacion: { select: { id: true, numero: true, tipo_habitacion: { select: { nombre: true, capacidad_adultos: true, capacidad_ninos: true } } } },
  turno: { select: { nombre: true, duracion_horas: true } },
  canal_venta: { select: { nombre: true } },
  estancia_huesped: { include: { cliente: { include: { tipo_documento: true } } }, orderBy: { es_titular: 'desc' as const } },
  estancia_cargo: { where: { anulado: false }, orderBy: { created_at: 'asc' as const } },
  reserva_habitacion: { select: { reserva: { select: { id: true, codigo: true, monto_adelanto: true, cliente_id: true, comision_porcentaje: true } } } },
} satisfies Prisma.estanciaInclude;

type FilaEstancia = Prisma.estanciaGetPayload<{ include: typeof INCLUIR }>;

const nombreCliente = (c: { nombre_completo: string | null; razon_social: string | null }) => c.nombre_completo ?? c.razon_social ?? '';

/**
 * Estadía en curso y su salida (spec S-07 §3–§4): check-in directo, huéspedes acompañantes, consumos, cuenta y
 * check-out con cobro, comprobante y caja en una sola transacción.
 */
@Injectable()
export class EstanciasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly avisos: AvisosTablero,
    private readonly config: ConfiguracionService,
    private readonly caja: CajaService,
  ) {}

  productos(empresaId: number) {
    return this.prisma.producto
      .findMany({ where: { empresa_id: empresaId, activo: true, es_hospedaje: false }, orderBy: [{ categoria_id: 'asc' }, { nombre: 'asc' }], include: { categoria: { select: { nombre: true } } } })
      .then((ps) => ps.map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, precio: p.precio_venta.toFixed(2), categoria: p.categoria.nombre, tipo: p.tipo })));
  }

  async porHabitacion(sucursalId: number, habitacionId: number) {
    const e = await this.prisma.estancia.findFirst({ where: { sucursal_id: sucursalId, habitacion_id: habitacionId, estado: 'ACTIVA' }, select: { id: true } });
    if (!e) throw new NotFoundException('La habitación no tiene una estadía en curso');
    return this.detalle(sucursalId, e.id);
  }

  async detalle(sucursalId: number, id: bigint | number) {
    const e = await this.buscar(sucursalId, id);
    const grupo = await this.grupo(e);
    return { ...this.vista(e), cuenta: this.cuenta(grupo), grupo: grupo.map((g) => ({ id: Number(g.id), habitacion: g.habitacion.numero })) };
  }

  /** Huésped que llega sin reserva: precio de la tarifa vigente de hoy y la habitación pasa a OCUPADA. */
  async checkinDirecto(actor: UsuarioSesion, d: CheckinDirecto) {
    const c = { empresaId: actor.empresaId, sucursalId: actor.sucursalId };
    const [hab, turno, canal] = await Promise.all([
      this.prisma.habitacion.findFirst({ where: { id: d.habitacionId, sucursal_id: c.sucursalId, activo: true }, include: { estado_habitacion: true, tipo_habitacion: true } }),
      this.prisma.turno.findFirst({ where: { id: d.turnoId, activo: true } }),
      this.prisma.canal_venta.findFirst({ where: { id: d.canalId, empresa_id: c.empresaId, activo: true } }),
    ]);
    if (!hab) throw new BadRequestException('La habitación no existe o está inactiva');
    if (!turno) throw new BadRequestException('Turno no válido');
    if (!canal) throw new BadRequestException('Canal no válido');
    const huespedes = [d.clienteId, ...(d.acompanantes ?? [])];
    if (new Set(huespedes).size !== huespedes.length) throw new BadRequestException('Hay huéspedes repetidos');
    const clientes = await this.prisma.cliente.findMany({ where: { id: { in: huespedes }, empresa_id: c.empresaId }, include: { tipo_documento: true } });
    if (clientes.length !== huespedes.length) throw new BadRequestException('Hay huéspedes que no existen');
    this.exigirPersonas(clientes);
    const ahora = new Date();
    const hoy = hoyLima(ahora);
    let salida: Date;
    let libro: ReturnType<typeof normalizarLibro>;
    try {
      if (!esEstado(hab.estado_habitacion.codigo)) throw new ReglaReservaError('Estado desconocido');
      validarTransicion(hab.estado_habitacion.codigo, 'OCUPADA');
      validarHuespedes(huespedes.length, 0, { adultos: hab.tipo_habitacion.capacidad_adultos + hab.tipo_habitacion.capacidad_ninos, ninos: 0 });
      salida = turno.duracion_horas === 24 ? rangoPorNoches(hoy, d.cantidad).salida : rangoPorHoras(hoy, '00:00', turno.duracion_horas, d.cantidad).salida;
      if (turno.duracion_horas !== 24) salida = new Date(ahora.getTime() + turno.duracion_horas * d.cantidad * 3_600_000);
      libro = normalizarLibro(d);
    } catch (e) {
      traducir(e);
    }
    const tarifa = await this.config.precioVigente(c, { tipoId: hab.tipo_habitacion_id, canalId: canal.id, turnoId: turno.id }, hoy);
    try {
      const creada = await this.prisma.$transaction(async (tx) => {
        // Habitación bloqueada: no choca con una reserva por llegar ni con otro check-in simultáneo (RF-RES-18).
        await bloquearHabitaciones(tx, [hab.id]);
        await exigirSinCruces(tx, [hab.id], ahora, salida, {}, ahora);
        await exigirNoAlojados(tx, huespedes);
        const e = await tx.estancia.create({
          data: {
            sucursal_id: c.sucursalId, habitacion_id: hab.id, canal_venta_id: canal.id, comision_porcentaje: canal.comision_porcentaje, turno_id: turno.id,
            checkin_at: ahora, checkout_previsto: salida, cantidad_turnos: d.cantidad, precio_unitario: new Prisma.Decimal(tarifa.precio),
            procedencia: d.procedencia?.trim() || null, placa_vehiculo: d.placa?.trim().toUpperCase() || null, usuario_checkin_id: actor.sub,
            destino: libro.destino, motivo_viaje: libro.motivoViaje,
            estancia_huesped: { create: huespedes.map((id, i) => ({ cliente_id: id, es_titular: i === 0 })) },
          },
        });
        await this.cambiarEstadoHabitacion(tx, hab.id, 'OCUPADA', actor.sub, 'Check-in directo (sin reserva)');
        await this.auditoria.registrar(tx, { accion: 'estancia.checkin', tabla: 'estancia', registroId: e.id, despues: { habitacion: hab.numero, huespedes, precio: tarifa.precio, cantidad: d.cantidad } });
        return e;
      });
      await this.avisos.avisar(c.sucursalId, 'estado');
      return this.detalle(c.sucursalId, creada.id);
    } catch (e) {
      traducir(e);
    }
  }

  async agregarHuesped(actor: UsuarioSesion, id: number, clienteId: number) {
    const e = await this.buscar(actor.sucursalId, id, true);
    const cliente = await this.prisma.cliente.findFirst({ where: { id: clienteId, empresa_id: actor.empresaId }, include: { tipo_documento: true } });
    if (!cliente) throw new BadRequestException('El huésped no existe');
    this.exigirPersonas([cliente]);
    if (e.estancia_huesped.some((h) => h.cliente_id === BigInt(clienteId))) throw new ConflictException('Ese huésped ya está registrado en la habitación');
    const cap = e.habitacion.tipo_habitacion.capacidad_adultos + e.habitacion.tipo_habitacion.capacidad_ninos;
    if (e.estancia_huesped.length + 1 > cap) throw new BadRequestException(`La habitación admite como máximo ${cap} personas`);
    await this.prisma.$transaction(async (tx) => {
      await exigirNoAlojados(tx, [clienteId]);
      await tx.estancia_huesped.create({ data: { estancia_id: e.id, cliente_id: clienteId, es_titular: false } });
      await this.auditoria.registrar(tx, { accion: 'estancia.huesped', tabla: 'estancia', registroId: e.id, despues: { clienteId, nombre: nombreCliente(cliente) } });
    });
    return this.detalle(actor.sucursalId, e.id);
  }

  /** Consumo de un producto (frigobar, lavandería) o cargo libre (hora extra) a la cuenta de la habitación. */
  async agregarCargo(actor: UsuarioSesion, id: number, d: { productoId?: number; descripcion?: string; cantidad: number; precio?: number }) {
    const e = await this.buscar(actor.sucursalId, id, true);
    let descripcion = d.descripcion?.trim() ?? '';
    let precio = d.precio;
    if (d.productoId) {
      const p = await this.prisma.producto.findFirst({ where: { id: d.productoId, empresa_id: actor.empresaId, activo: true } });
      if (!p) throw new BadRequestException('El producto no existe');
      descripcion = p.nombre;
      precio = precio ?? Number(p.precio_venta);
    }
    if (!descripcion) throw new BadRequestException('Describe el cargo');
    if (precio === undefined || !(precio >= 0) || !(d.cantidad > 0)) throw new BadRequestException('Cantidad y precio no válidos');
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.estancia_cargo.create({
        data: { estancia_id: e.id, producto_id: d.productoId ?? null, descripcion, cantidad: new Prisma.Decimal(d.cantidad), precio_unitario: new Prisma.Decimal(precio!.toFixed(2)), usuario_id: actor.sub },
      });
      await this.auditoria.registrar(tx, { accion: 'estancia.cargo', tabla: 'estancia_cargo', registroId: c.id, despues: { habitacion: e.habitacion.numero, descripcion, cantidad: d.cantidad, precio } });
    });
    return this.detalle(actor.sucursalId, e.id);
  }

  async anularCargo(actor: UsuarioSesion, id: number, cargoId: number) {
    const e = await this.buscar(actor.sucursalId, id, true);
    const c = e.estancia_cargo.find((x) => x.id === BigInt(cargoId));
    if (!c) throw new NotFoundException('El cargo no existe en esta estadía');
    await this.prisma.$transaction(async (tx) => {
      await tx.estancia_cargo.update({ where: { id: c.id }, data: { anulado: true } });
      await this.auditoria.registrar(tx, { accion: 'estancia.cargo_anulado', tabla: 'estancia_cargo', registroId: c.id, antes: { descripcion: c.descripcion, total: c.total } });
    });
    return this.detalle(actor.sucursalId, e.id);
  }

  /**
   * Check-out con cobro (S-07 §4): cierra todas las habitaciones de la misma reserva juntas, emite el comprobante
   * (BOLETA, FACTURA o INTERNO) con el detalle, registra los pagos en la caja abierta, deja las habitaciones en
   * LIMPIEZA y la reserva FINALIZADA. Todo o nada.
   */
  async checkout(actor: UsuarioSesion, id: number, d: Checkout) {
    const e = await this.buscar(actor.sucursalId, id, true);
    const grupo = await this.grupo(e);
    const ahora = new Date();
    const cuenta = this.cuenta(grupo, ahora);
    const metodos = await this.prisma.metodo_pago.findMany({ where: { activo: true } });
    let reparto: ReturnType<typeof repartirPagos>;
    try {
      reparto = repartirPagos(aCentimos(cuenta.saldo), d.pagos.map((p) => {
        const m = metodos.find((x) => x.id === p.metodoPagoId);
        if (!m) throw new ReglaCobroError('Método de pago no válido');
        return { metodo: m.codigo, esEfectivo: m.es_efectivo, monto: p.monto, referencia: p.referencia ?? null };
      }));
    } catch (err) {
      traducir(err);
    }
    const titularId = d.clienteId ?? Number(grupo[0].estancia_huesped.find((h) => h.es_titular)?.cliente_id ?? grupo[0].estancia_huesped[0].cliente_id);
    const cliente = await this.prisma.cliente.findFirst({ where: { id: titularId, empresa_id: actor.empresaId }, include: { tipo_documento: true } });
    if (!cliente) throw new BadRequestException('El cliente del comprobante no existe');
    if (d.tipoComprobante === 'FACTURA' && cliente.tipo_documento.abreviatura !== 'RUC') throw new BadRequestException('La factura requiere un cliente con RUC');
    const tipo = await this.prisma.tipo_comprobante.findUniqueOrThrow({ where: { codigo: d.tipoComprobante } });
    const serie =
      (await this.prisma.serie.findFirst({ where: { sucursal_id: actor.sucursalId, tipo_comprobante_id: tipo.id, activo: true, usuario_serie: { some: { usuario_id: actor.sub } } } })) ??
      (await this.prisma.serie.findFirst({ where: { sucursal_id: actor.sucursalId, tipo_comprobante_id: tipo.id, activo: true }, orderBy: { id: 'asc' } }));
    if (!serie) throw new ConflictException(`La sucursal no tiene una serie activa para ${d.tipoComprobante.toLowerCase()}`);
    const [pen, um, afecto] = await Promise.all([
      this.prisma.moneda.findUniqueOrThrow({ where: { codigo_iso: 'PEN' } }),
      this.prisma.unidad_medida.findMany({ where: { codigo_sunat: { in: ['ZZ', 'NIU'] } } }),
      this.prisma.tipo_afectacion_igv.findFirstOrThrow({ where: { codigo_sunat: '10' } }),
    ]);
    const umServicio = um.find((u) => u.codigo_sunat === 'ZZ')!.id;
    const umBien = um.find((u) => u.codigo_sunat === 'NIU')!.id;
    const totales = totalesComprobante(cuenta.lineas);
    const lima = new Date(ahora.getTime() - 5 * 3_600_000).toISOString();

    try {
      const comp = await this.prisma.$transaction(async (tx) => {
        const sesion = reparto.registrados.length ? await this.caja.exigirSesion(tx, actor.sucursalId) : await this.caja.sesionAbierta(tx, actor.sucursalId);
        // Correlativo con bloqueo de fila (sp_siguiente_correlativo) dentro de la misma transacción
        await tx.$executeRaw`CALL sp_siguiente_correlativo(${serie.id}, @numero)`;
        const [{ numero }] = await tx.$queryRaw<Array<{ numero: number | bigint }>>`SELECT @numero AS numero`;
        const comprobante = await tx.comprobante.create({
          data: {
            sucursal_id: actor.sucursalId, serie_id: serie.id, tipo_comprobante_id: tipo.id, serie: serie.serie, numero: Number(numero),
            fecha_emision: new Date(`${lima.slice(0, 10)}T00:00:00Z`), hora_emision: new Date(`1970-01-01T${lima.slice(11, 19)}Z`),
            cliente_id: cliente.id, cliente_tipo_doc: cliente.tipo_documento.codigo_sunat, cliente_num_doc: cliente.numero_documento,
            cliente_nombre: nombreCliente(cliente), cliente_direccion: cliente.direccion ?? null, moneda_id: pen.id,
            estancia_id: grupo[0].id, reserva_id: cuenta.reserva ? BigInt(cuenta.reserva.id) : null, caja_sesion_id: sesion?.id ?? null,
            total_gravada: new Prisma.Decimal(totales.gravada), total_igv: new Prisma.Decimal(totales.igv), total: new Prisma.Decimal(totales.total),
            monto_letras: montoEnLetras(totales.total), usuario_id: actor.sub,
            comprobante_detalle: {
              create: cuenta.lineas.map((l, i) => {
                const des = desglosarIgv(aCentimos(l.total));
                return {
                  item: i + 1, producto_id: l.productoId ?? null, estancia_id: l.estanciaId ? BigInt(l.estanciaId) : null, descripcion: l.descripcion,
                  unidad_medida_id: l.tipo === 'HOSPEDAJE' ? umServicio : umBien, tipo_afectacion_igv_id: afecto.id, cantidad: new Prisma.Decimal(l.cantidad),
                  valor_unitario: new Prisma.Decimal((des.valorVenta / 100 / l.cantidad).toFixed(4)), precio_unitario: new Prisma.Decimal(l.precioUnitario),
                  valor_venta: new Prisma.Decimal(aSoles(des.valorVenta)), igv: new Prisma.Decimal(aSoles(des.igv)), total: new Prisma.Decimal(l.total),
                };
              }),
            },
          },
        });
        // Pagos: el adelanto de la reserva (ya entró a caja al reservar) y lo cobrado ahora
        if (aCentimos(cuenta.adelanto) > 0) {
          const mAdelanto = await tx.caja_movimiento.findFirst({ where: { reserva_id: BigInt(cuenta.reserva!.id) } });
          await tx.comprobante_pago.create({
            data: { comprobante_id: comprobante.id, metodo_pago_id: mAdelanto?.metodo_pago_id ?? metodos.find((m) => m.codigo === 'EFECTIVO')!.id, monto: new Prisma.Decimal(cuenta.adelanto), referencia: `Adelanto ${cuenta.reserva!.codigo}` },
          });
        }
        for (const p of reparto.registrados) {
          const m = metodos.find((x) => x.codigo === p.metodo)!;
          await tx.comprobante_pago.create({ data: { comprobante_id: comprobante.id, metodo_pago_id: m.id, monto: new Prisma.Decimal(p.monto.toFixed(2)), referencia: p.referencia ?? null } });
          await this.caja.registrar(tx, {
            sesionId: sesion!.id, concepto: 'VENTA', metodoPagoId: m.id, monto: p.monto.toFixed(2), usuarioId: actor.sub,
            reservaId: cuenta.reserva ? BigInt(cuenta.reserva.id) : null, comprobanteId: comprobante.id, descripcion: `${comprobante.serie}-${String(comprobante.numero).padStart(8, '0')} · Hab. ${grupo.map((g) => g.habitacion.numero).join(', ')}`,
          });
        }
        for (const g of grupo) {
          // Se guardan los turnos consumidos: los contratados más los de una salida tardía (RF-RES-12).
          const extra = turnosAdicionales(g.checkout_previsto, ahora, g.turno.duracion_horas);
          await tx.estancia.update({ where: { id: g.id }, data: { estado: 'FINALIZADA', checkout_at: ahora, usuario_checkout_id: actor.sub, cantidad_turnos: g.cantidad_turnos + extra } });
          await this.cambiarEstadoHabitacion(tx, g.habitacion_id, 'LIMPIEZA', actor.sub, `Check-out ${comprobante.serie}-${String(comprobante.numero).padStart(8, '0')}`);
        }
        if (cuenta.reserva) await tx.reserva.update({ where: { id: BigInt(cuenta.reserva.id) }, data: { estado: 'FINALIZADA' } });
        await this.auditoria.registrar(tx, {
          accion: 'estancia.checkout',
          tabla: 'comprobante',
          registroId: comprobante.id,
          despues: { comprobante: `${comprobante.serie}-${comprobante.numero}`, total: totales.total, habitaciones: grupo.map((g) => g.habitacion.numero), pagos: reparto.registrados, vuelto: aSoles(reparto.vuelto) },
        });
        return comprobante;
      });
      await this.avisos.avisar(actor.sucursalId, 'estado');
      return { comprobanteId: Number(comp.id), comprobante: `${comp.serie}-${String(comp.numero).padStart(8, '0')}`, total: totales.total, vuelto: aSoles(reparto.vuelto) };
    } catch (err) {
      traducir(err);
    }
  }

  /** Suma turnos a una estadía en curso, al mismo precio pactado, si la habitación sigue libre (RF-RES-13). */
  async extender(actor: UsuarioSesion, id: number, turnos: number) {
    try {
      validarExtension(turnos);
    } catch (err) {
      traducir(err);
    }
    const e = await this.buscar(actor.sucursalId, id, true);
    try {
      await this.prisma.$transaction(async (tx) => {
        await bloquearHabitaciones(tx, [e.habitacion_id]);
        const actual = await tx.estancia.findUniqueOrThrow({ where: { id: e.id } });
        if (actual.estado !== 'ACTIVA') throw new ConflictException('La estadía ya terminó');
        const nueva = salidaExtendida(actual.checkout_previsto, e.turno.duracion_horas, turnos);
        await exigirSinCruces(tx, [e.habitacion_id], actual.checkout_previsto, nueva, {
          estanciaId: e.id,
          ...(e.reserva_habitacion && { reservaId: e.reserva_habitacion.reserva.id }),
        });
        await tx.estancia.update({ where: { id: e.id }, data: { cantidad_turnos: actual.cantidad_turnos + turnos, checkout_previsto: nueva } });
        // La habitación de la reserva acompaña la nueva salida para que el calendario y los cruces la vean.
        if (actual.reserva_habitacion_id) await tx.reserva_habitacion.update({ where: { id: actual.reserva_habitacion_id }, data: { fecha_salida: nueva } });
        await this.auditoria.registrar(tx, {
          accion: 'estancia.extender',
          tabla: 'estancia',
          registroId: e.id,
          antes: { cantidad: actual.cantidad_turnos, salida: actual.checkout_previsto },
          despues: { cantidad: actual.cantidad_turnos + turnos, salida: nueva, turnosAgregados: turnos },
        });
      });
    } catch (err) {
      traducir(err);
    }
    await this.avisos.avisar(actor.sucursalId, 'estado');
    return this.detalle(actor.sucursalId, e.id);
  }

  /**
   * Traslada la estadía a otra habitación con su motivo (RF-RES-14). El precio pactado no cambia; la habitación
   * que se deja pasa a limpieza y la nueva a ocupada.
   */
  async trasladar(actor: UsuarioSesion, id: number, d: { habitacionId: number; motivo: string }) {
    const e = await this.buscar(actor.sucursalId, id, true);
    let motivo: string;
    try {
      motivo = normalizarMotivoTraslado(d.motivo);
    } catch (err) {
      traducir(err);
    }
    if (d.habitacionId === e.habitacion_id) throw new BadRequestException('Elige una habitación distinta');
    const destino = await this.prisma.habitacion.findFirst({
      where: { id: d.habitacionId, sucursal_id: actor.sucursalId, activo: true },
      include: { tipo_habitacion: true },
    });
    if (!destino) throw new BadRequestException('La habitación de destino no existe o está inactiva');
    const cap = destino.tipo_habitacion.capacidad_adultos + destino.tipo_habitacion.capacidad_ninos;
    if (e.estancia_huesped.length > cap) throw new BadRequestException(`La habitación ${destino.numero} admite como máximo ${cap} personas`);
    const ahora = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await bloquearHabitaciones(tx, [e.habitacion_id, destino.id]);
        const actual = await tx.habitacion.findUniqueOrThrow({ where: { id: destino.id }, include: { estado_habitacion: true } });
        if (!esEstado(actual.estado_habitacion.codigo)) throw new ReglaEstadiaError('Estado de habitación desconocido');
        validarTransicion(actual.estado_habitacion.codigo, 'OCUPADA');
        const fin = e.checkout_previsto > ahora ? e.checkout_previsto : new Date(ahora.getTime() + 60_000);
        await exigirSinCruces(tx, [destino.id], ahora, fin, {}, ahora);
        await tx.estancia.update({ where: { id: e.id }, data: { habitacion_id: destino.id } });
        if (e.reserva_habitacion_id) await tx.reserva_habitacion.update({ where: { id: e.reserva_habitacion_id }, data: { habitacion_id: destino.id } });
        await tx.estancia_traslado.create({
          data: { estancia_id: e.id, habitacion_origen_id: e.habitacion_id, habitacion_destino_id: destino.id, motivo, usuario_id: actor.sub },
        });
        await this.cambiarEstadoHabitacion(tx, e.habitacion_id, 'LIMPIEZA', actor.sub, `Traslado a la ${destino.numero}: ${motivo}`);
        await this.cambiarEstadoHabitacion(tx, destino.id, 'OCUPADA', actor.sub, `Traslado desde la ${e.habitacion.numero}: ${motivo}`);
        await this.auditoria.registrar(tx, {
          accion: 'estancia.traslado',
          tabla: 'estancia',
          registroId: e.id,
          antes: { habitacion: e.habitacion.numero },
          despues: { habitacion: destino.numero, motivo },
        });
      });
    } catch (err) {
      traducir(err);
    }
    await this.avisos.avisar(actor.sucursalId, 'estado');
    return this.detalle(actor.sucursalId, e.id);
  }

  /** Libro de registro de huéspedes por fecha de ingreso (RF-RES-11), desde la vista `vw_libro_huespedes`. */
  async libro(sucursalId: number, desde: string, hasta: string) {
    if (!esFecha(desde) || !esFecha(hasta)) throw new BadRequestException('Fecha no válida; usa AAAA-MM-DD');
    if (hasta < desde) throw new BadRequestException('La fecha final es anterior a la inicial');
    if (sumarDias(desde, 31) <= hasta) throw new BadRequestException('El rango admite hasta 31 días');
    const filas = await this.prisma.$queryRaw<
      Array<{
        estancia_id: bigint;
        fecha_entrada: Date;
        fecha_salida: Date | null;
        habitacion: string;
        huesped: string;
        tipo_doc: string;
        numero_documento: string;
        nacionalidad: string;
        fecha_nacimiento: Date | null;
        sexo: string | null;
        procedencia: string | null;
        destino: string | null;
        motivo_viaje: string | null;
        es_titular: number | boolean;
      }>
    >`SELECT * FROM vw_libro_huespedes
       WHERE sucursal_id = ${sucursalId} AND fecha_entrada >= ${inicioDiaLima(desde)} AND fecha_entrada < ${inicioDiaLima(sumarDias(hasta, 1))}
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

  // ── Internos ──────────────────────────────────────────────────

  /** Una empresa (RUC 20) puede reservar y recibir la factura, pero no alojarse. */
  private exigirPersonas(clientes: Array<{ numero_documento: string; razon_social: string | null; nombre_completo: string | null; tipo_documento: { abreviatura: string } }>) {
    const empresa = clientes.find((x) => x.tipo_documento.abreviatura === 'RUC' && x.numero_documento.startsWith('20'));
    if (empresa) throw new BadRequestException(`${empresa.razon_social ?? empresa.nombre_completo} es una empresa: registra a la persona que se aloja`);
  }

  private async buscar(sucursalId: number, id: bigint | number, soloActiva = false): Promise<FilaEstancia> {
    const e = await this.prisma.estancia.findFirst({ where: { id: BigInt(id), sucursal_id: sucursalId }, include: INCLUIR });
    if (!e) throw new NotFoundException('La estadía no existe en tu sucursal');
    if (soloActiva && e.estado !== 'ACTIVA') throw new ConflictException('La estadía ya terminó');
    return e;
  }

  /** Estancias que se cobran juntas: las activas de la misma reserva (una familia en dos habitaciones). */
  private async grupo(e: FilaEstancia): Promise<FilaEstancia[]> {
    const reservaId = e.reserva_habitacion?.reserva.id;
    if (!reservaId || e.estado !== 'ACTIVA') return [e];
    const otras = await this.prisma.estancia.findMany({ where: { estado: 'ACTIVA', reserva_habitacion: { reserva_id: reservaId }, NOT: { id: e.id } }, include: INCLUIR, orderBy: { id: 'asc' } });
    return [e, ...otras];
  }

  /**
   * Cuenta de la estadía. Una estadía en curso que pasó su salida prevista más la tolerancia suma los turnos
   * consumidos (RF-RES-12), con el mismo precio pactado.
   */
  private cuenta(grupo: FilaEstancia[], ahora: Date = new Date()) {
    const lineas: LineaCuenta[] = [];
    for (const g of grupo) {
      const horas = g.turno.duracion_horas;
      const extra = g.estado === 'ACTIVA' ? turnosAdicionales(g.checkout_previsto, ahora, horas) : 0;
      const n = g.cantidad_turnos + extra;
      lineas.push({
        tipo: 'HOSPEDAJE',
        descripcion:
          `Hospedaje hab. ${g.habitacion.numero} (${g.habitacion.tipo_habitacion.nombre}) · ${horas === 24 ? `${n} ${n === 1 ? 'noche' : 'noches'}` : `${n} × turno de ${horas} h`}` +
          (extra ? ` (incluye ${extra} por salida tardía)` : ''),
        cantidad: n,
        precioUnitario: g.precio_unitario.toFixed(2),
        total: g.precio_unitario.mul(n).toFixed(2),
        estanciaId: String(g.id),
      });
      for (const c of g.estancia_cargo) {
        lineas.push({
          tipo: 'CARGO',
          descripcion: `${c.descripcion}${grupo.length > 1 ? ` (hab. ${g.habitacion.numero})` : ''}`,
          cantidad: Number(c.cantidad),
          precioUnitario: c.precio_unitario.toFixed(2),
          total: c.cantidad.mul(c.precio_unitario).toDecimalPlaces(2).toFixed(2),
          cargoId: String(c.id),
          estanciaId: String(g.id),
          productoId: c.producto_id,
        });
      }
    }
    const total = lineas.reduce((s, l) => s + aCentimos(l.total), 0);
    const reserva = grupo[0].reserva_habitacion?.reserva ?? null;
    const adelanto = reserva ? Math.min(aCentimos(reserva.monto_adelanto.toFixed(2)), total) : 0;
    const hospedaje = lineas.filter((l) => l.tipo === 'HOSPEDAJE').reduce((s, l) => s + aCentimos(l.total), 0);
    const porcentaje = reserva ? reserva.comision_porcentaje.toFixed(2) : grupo[0].comision_porcentaje.toFixed(2);
    return {
      lineas,
      total: aSoles(total),
      adelanto: aSoles(adelanto),
      saldo: aSoles(total - adelanto),
      comision: { porcentaje, monto: aSoles(comision(hospedaje, porcentaje)) },
      reserva: reserva ? { id: Number(reserva.id), codigo: reserva.codigo } : null,
    };
  }

  private vista(e: FilaEstancia) {
    return {
      id: Number(e.id),
      estado: e.estado,
      habitacion: { id: e.habitacion.id, numero: e.habitacion.numero, tipo: e.habitacion.tipo_habitacion.nombre, capacidad: e.habitacion.tipo_habitacion.capacidad_adultos + e.habitacion.tipo_habitacion.capacidad_ninos },
      checkin: e.checkin_at,
      salidaPrevista: e.checkout_previsto,
      checkout: e.checkout_at,
      turno: e.turno.nombre,
      horasTurno: e.turno.duracion_horas,
      cantidad: e.cantidad_turnos,
      precio: e.precio_unitario.toFixed(2),
      canal: e.canal_venta.nombre,
      procedencia: e.procedencia,
      destino: e.destino,
      motivoViaje: e.motivo_viaje,
      placa: e.placa_vehiculo,
      reserva: e.reserva_habitacion?.reserva.codigo ?? null,
      huespedes: e.estancia_huesped.map((h) => ({ id: Number(h.cliente_id), titular: h.es_titular, nombre: nombreCliente(h.cliente), documento: `${h.cliente.tipo_documento.abreviatura} ${h.cliente.numero_documento}` })),
      cargos: e.estancia_cargo.map((c) => ({ id: Number(c.id), descripcion: c.descripcion, cantidad: Number(c.cantidad), precio: c.precio_unitario.toFixed(2), total: c.cantidad.mul(c.precio_unitario).toDecimalPlaces(2).toFixed(2), fecha: c.created_at })),
    };
  }

  private async cambiarEstadoHabitacion(tx: Tx, habitacionId: number, codigo: string, usuarioId: number, motivo: string) {
    const estado = await tx.estado_habitacion.findUniqueOrThrow({ where: { codigo } });
    await tx.$executeRaw`SET @app_usuario_id = ${usuarioId}, @app_motivo = ${motivo}`;
    await tx.habitacion.update({ where: { id: habitacionId }, data: { estado_habitacion_id: estado.id } });
  }
}
