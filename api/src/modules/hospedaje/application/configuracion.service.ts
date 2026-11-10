import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { AvisosTablero } from './avisos-tablero.service';
import {
  esFecha,
  fechaADb,
  fechaDeDb,
  hoyLima,
  planificarTarifa,
  ReglaTarifaError,
  tarifaProgramada,
  tarifaVigente,
  validarPrecio,
  Vigencia,
} from '../domain/tarifa';

export interface ContextoSucursal {
  empresaId: number;
  sucursalId: number;
}

export interface ClaveTarifa {
  tipoId: number;
  canalId: number;
  turnoId: number;
}

/** Errores de dominio y claves únicas → 400 / 409. */
function traducir(e: unknown, duplicado: string): never {
  if (e instanceof ReglaTarifaError) throw new BadRequestException(e.message);
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(duplicado);
  throw e;
}

const comoVigencia = (t: { id: number; vigente_desde: Date; vigente_hasta: Date | null; activo: boolean }): Vigencia & { activo: boolean } => ({
  id: t.id,
  desde: fechaDeDb(t.vigente_desde),
  hasta: t.vigente_hasta ? fechaDeDb(t.vigente_hasta) : null,
  activo: t.activo,
});

/**
 * Configuración de la sucursal activa: pisos, tipos, habitaciones y tarifas (spec S-04 §5). No se borra nada
 * que tenga historia; se desactiva (D8). Toda escritura se audita en su transacción.
 */
@Injectable()
export class ConfiguracionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly avisos: AvisosTablero,
  ) {}

  // ── Pisos ───────────────────────────────────────────────────────

  async pisos(c: ContextoSucursal) {
    const filas = await this.prisma.piso.findMany({
      where: { sucursal_id: c.sucursalId },
      include: { _count: { select: { habitacion: { where: { activo: true } } } } },
      orderBy: { numero: 'asc' },
    });
    return filas.map((p) => ({ id: p.id, numero: p.numero, nombre: p.nombre, activo: p.activo, habitaciones: p._count.habitacion }));
  }

  async crearPiso(c: ContextoSucursal, d: { numero: number; nombre: string }) {
    try {
      const creado = await this.prisma.$transaction(async (tx) => {
        const piso = await tx.piso.create({ data: { sucursal_id: c.sucursalId, numero: d.numero, nombre: d.nombre.trim() } });
        await this.auditoria.registrar(tx, { accion: 'piso.crear', tabla: 'piso', registroId: piso.id, despues: piso });
        return piso;
      });
      await this.avisos.avisar(c.sucursalId, 'piso'); // no rechaza: no lo alcanza el catch
      return creado;
    } catch (e) {
      traducir(e, `Ya existe el piso ${d.numero} en esta sucursal`);
    }
  }

  async editarPiso(c: ContextoSucursal, id: number, d: { nombre?: string; activo?: boolean }) {
    const antes = await this.prisma.piso.findFirst({ where: { id, sucursal_id: c.sucursalId } });
    if (!antes) throw new NotFoundException('El piso no existe en tu sucursal');
    if (d.activo === false && antes.activo) {
      const activas = await this.prisma.habitacion.count({ where: { piso_id: id, activo: true } });
      if (activas > 0) throw new ConflictException(`El piso tiene ${activas} habitaciones activas; muévelas o desactívalas primero`);
    }
    const editado = await this.prisma.$transaction(async (tx) => {
      const despues = await tx.piso.update({ where: { id }, data: { ...(d.nombre !== undefined && { nombre: d.nombre.trim() }), ...(d.activo !== undefined && { activo: d.activo }) } });
      await this.auditoria.registrar(tx, { accion: 'piso.editar', tabla: 'piso', registroId: id, antes, despues });
      return despues;
    });
    await this.avisos.avisar(c.sucursalId, 'piso');
    return editado;
  }

  // ── Tipos de habitación (por empresa) ──────────────────────────

  async tipos(c: ContextoSucursal) {
    const filas = await this.prisma.tipo_habitacion.findMany({
      where: { empresa_id: c.empresaId },
      include: { _count: { select: { habitacion: { where: { activo: true, sucursal_id: c.sucursalId } } } } },
      orderBy: { id: 'asc' },
    });
    return filas.map((t) => ({
      id: t.id,
      nombre: t.nombre,
      descripcion: t.descripcion,
      capacidadAdultos: t.capacidad_adultos,
      capacidadNinos: t.capacidad_ninos,
      activo: t.activo,
      habitaciones: t._count.habitacion,
    }));
  }

  async crearTipo(c: ContextoSucursal, d: { nombre: string; descripcion?: string | null; capacidadAdultos: number; capacidadNinos: number }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const tipo = await tx.tipo_habitacion.create({
          data: {
            empresa_id: c.empresaId,
            nombre: d.nombre.trim(),
            descripcion: d.descripcion?.trim() || null,
            capacidad_adultos: d.capacidadAdultos,
            capacidad_ninos: d.capacidadNinos,
          },
        });
        await this.auditoria.registrar(tx, { accion: 'tipo_habitacion.crear', tabla: 'tipo_habitacion', registroId: tipo.id, despues: tipo });
        return tipo;
      });
    } catch (e) {
      traducir(e, `Ya existe el tipo «${d.nombre.trim()}»`);
    }
  }

  async editarTipo(
    c: ContextoSucursal,
    id: number,
    d: { nombre?: string; descripcion?: string | null; capacidadAdultos?: number; capacidadNinos?: number; activo?: boolean },
  ) {
    const antes = await this.prisma.tipo_habitacion.findFirst({ where: { id, empresa_id: c.empresaId } });
    if (!antes) throw new NotFoundException('El tipo de habitación no existe');
    if (d.activo === false && antes.activo) {
      const enUso = await this.prisma.habitacion.count({ where: { tipo_habitacion_id: id, activo: true } });
      if (enUso > 0) throw new ConflictException(`Hay ${enUso} habitaciones activas de este tipo; cámbialas de tipo primero`);
    }
    try {
      const editado = await this.prisma.$transaction(async (tx) => {
        const despues = await tx.tipo_habitacion.update({
          where: { id },
          data: {
            ...(d.nombre !== undefined && { nombre: d.nombre.trim() }),
            ...(d.descripcion !== undefined && { descripcion: d.descripcion?.trim() || null }),
            ...(d.capacidadAdultos !== undefined && { capacidad_adultos: d.capacidadAdultos }),
            ...(d.capacidadNinos !== undefined && { capacidad_ninos: d.capacidadNinos }),
            ...(d.activo !== undefined && { activo: d.activo }),
          },
        });
        await this.auditoria.registrar(tx, { accion: 'tipo_habitacion.editar', tabla: 'tipo_habitacion', registroId: id, antes, despues });
        return despues;
      });
      await this.avisos.avisarEmpresa(c.empresaId, 'tipo'); // el tipo es de empresa: se ve en todas sus sucursales
      return editado;
    } catch (e) {
      traducir(e, `Ya existe el tipo «${d.nombre?.trim()}»`);
    }
  }

  // ── Habitaciones ────────────────────────────────────────────────

  async habitaciones(c: ContextoSucursal) {
    const filas = await this.prisma.habitacion.findMany({
      where: { sucursal_id: c.sucursalId },
      include: {
        piso: { select: { id: true, nombre: true, numero: true } },
        tipo_habitacion: { select: { id: true, nombre: true } },
        estado_habitacion: { select: { codigo: true } },
      },
      orderBy: [{ piso: { numero: 'asc' } }, { numero: 'asc' }],
    });
    return filas.map((h) => ({
      id: h.id,
      numero: h.numero,
      descripcion: h.descripcion,
      activo: h.activo,
      estado: h.estado_habitacion.codigo,
      piso: h.piso,
      tipo: h.tipo_habitacion,
    }));
  }

  async editarHabitacion(
    c: ContextoSucursal,
    id: number,
    d: { numero?: string; pisoId?: number; tipoHabitacionId?: number; descripcion?: string | null; activo?: boolean },
  ) {
    const antes = await this.prisma.habitacion.findFirst({ where: { id, sucursal_id: c.sucursalId }, include: { estado_habitacion: true } });
    if (!antes) throw new NotFoundException('La habitación no existe en tu sucursal');
    if (d.pisoId !== undefined) {
      const piso = await this.prisma.piso.findFirst({ where: { id: d.pisoId, sucursal_id: c.sucursalId, activo: true } });
      if (!piso) throw new BadRequestException('El piso no existe o está inactivo en tu sucursal');
    }
    if (d.tipoHabitacionId !== undefined) {
      const tipo = await this.prisma.tipo_habitacion.findFirst({ where: { id: d.tipoHabitacionId, empresa_id: c.empresaId, activo: true } });
      if (!tipo) throw new BadRequestException('El tipo de habitación no existe o está inactivo');
    }
    if (d.activo === false && antes.activo) {
      const activa = await this.prisma.estancia.count({ where: { habitacion_id: id, estado: 'ACTIVA' } });
      if (antes.estado_habitacion.codigo === 'OCUPADA' || activa > 0) throw new ConflictException('La habitación está ocupada; haz el check-out antes de desactivarla');
    }
    const { estado_habitacion: _e, ...datosAntes } = antes;
    try {
      const editada = await this.prisma.$transaction(async (tx) => {
        const despues = await tx.habitacion.update({
          where: { id },
          data: {
            ...(d.numero !== undefined && { numero: d.numero.trim() }),
            ...(d.pisoId !== undefined && { piso_id: d.pisoId }),
            ...(d.tipoHabitacionId !== undefined && { tipo_habitacion_id: d.tipoHabitacionId }),
            ...(d.descripcion !== undefined && { descripcion: d.descripcion?.trim() || null }),
            ...(d.activo !== undefined && { activo: d.activo }),
          },
        });
        await this.auditoria.registrar(tx, { accion: 'habitacion.editar', tabla: 'habitacion', registroId: id, antes: datosAntes, despues });
        return despues;
      });
      await this.avisos.avisar(c.sucursalId, 'habitacion');
      return editada;
    } catch (e) {
      traducir(e, `Ya existe la habitación ${d.numero?.trim()} en esta sucursal`);
    }
  }

  // ── Canales, turnos y tarifas ──────────────────────────────────

  canales(c: ContextoSucursal) {
    return this.prisma.canal_venta.findMany({
      where: { empresa_id: c.empresaId, activo: true },
      select: { id: true, nombre: true, es_ota: true, comision_porcentaje: true },
      orderBy: { id: 'asc' },
    });
  }

  turnos() {
    return this.prisma.turno.findMany({ where: { activo: true }, orderBy: { duracion_horas: 'desc' } });
  }

  /** Matriz tipo × canal × turno con el precio vigente en `fecha` y el próximo cambio programado. */
  async tarifas(c: ContextoSucursal, fecha?: string) {
    const dia = this.fecha(fecha);
    const filas = await this.prisma.tarifa.findMany({
      where: { sucursal_id: c.sucursalId },
      orderBy: { vigente_desde: 'asc' },
      include: { moneda: { select: { simbolo: true } } },
    });
    const grupos = new Map<string, typeof filas>();
    for (const f of filas) {
      const k = `${f.tipo_habitacion_id}-${f.canal_venta_id}-${f.turno_id}`;
      grupos.set(k, [...(grupos.get(k) ?? []), f]);
    }
    const celdas = [...grupos.values()].map((g) => {
      const porId = new Map(g.map((f) => [f.id, f]));
      const vig = g.map(comoVigencia);
      const actual = tarifaVigente(vig, dia);
      const prox = tarifaProgramada(vig, dia);
      const vista = (v: Vigencia | null) => {
        if (!v) return null;
        const f = porId.get(v.id)!;
        return { id: f.id, precio: f.precio.toFixed(2), moneda: f.moneda.simbolo, desde: v.desde, hasta: v.hasta };
      };
      return { tipoId: g[0].tipo_habitacion_id, canalId: g[0].canal_venta_id, turnoId: g[0].turno_id, vigente: vista(actual), programada: vista(prox) };
    });
    return { fecha: dia, hoy: hoyLima(), celdas };
  }

  async historialTarifa(c: ContextoSucursal, k: ClaveTarifa) {
    const filas = await this.prisma.tarifa.findMany({
      where: { sucursal_id: c.sucursalId, tipo_habitacion_id: k.tipoId, canal_venta_id: k.canalId, turno_id: k.turnoId },
      orderBy: { vigente_desde: 'desc' },
    });
    return filas.map((f) => ({ ...comoVigencia(f), precio: f.precio.toFixed(2), creada: f.created_at }));
  }

  /** Precio que rige para una clave en una fecha; lo usará la reserva (S-06). */
  async precioVigente(c: ContextoSucursal, k: ClaveTarifa, fecha?: string) {
    const dia = this.fecha(fecha);
    const filas = await this.prisma.tarifa.findMany({
      where: { sucursal_id: c.sucursalId, tipo_habitacion_id: k.tipoId, canal_venta_id: k.canalId, turno_id: k.turnoId },
      include: { moneda: { select: { codigo_iso: true, simbolo: true } } },
    });
    const v = tarifaVigente(filas.map(comoVigencia), dia);
    if (!v) throw new NotFoundException('No hay una tarifa vigente para esa combinación y fecha');
    const f = filas.find((x) => x.id === v.id)!;
    return { tarifaId: f.id, precio: f.precio.toFixed(2), moneda: f.moneda.codigo_iso, simbolo: f.moneda.simbolo, desde: v.desde, hasta: v.hasta, fecha: dia };
  }

  /** Programa un precio nuevo; la tarifa que regía se cierra el día anterior (D6). */
  async crearTarifa(c: ContextoSucursal, d: ClaveTarifa & { precio: number; desde?: string }) {
    try {
      validarPrecio(d.precio);
      const hoy = hoyLima();
      const desde = d.desde ?? hoy;
      await this.validarClave(c, d);
      const pen = await this.prisma.moneda.findUniqueOrThrow({ where: { codigo_iso: 'PEN' } });
      return await this.prisma.$transaction(async (tx) => {
        // Serializa dos cambios simultáneos de la misma clave
        await tx.$queryRaw`SELECT id FROM tarifa WHERE sucursal_id = ${c.sucursalId} AND tipo_habitacion_id = ${d.tipoId} AND canal_venta_id = ${d.canalId} AND turno_id = ${d.turnoId} FOR UPDATE`;
        const existentes = await tx.tarifa.findMany({
          where: { sucursal_id: c.sucursalId, tipo_habitacion_id: d.tipoId, canal_venta_id: d.canalId, turno_id: d.turnoId },
        });
        const plan = planificarTarifa(existentes.map(comoVigencia), desde, hoy);
        for (const x of plan.cerrar) await tx.tarifa.update({ where: { id: x.id }, data: { vigente_hasta: fechaADb(x.hasta) } });
        const nueva = await tx.tarifa.create({
          data: {
            sucursal_id: c.sucursalId,
            tipo_habitacion_id: d.tipoId,
            canal_venta_id: d.canalId,
            turno_id: d.turnoId,
            moneda_id: pen.id,
            precio: new Prisma.Decimal(d.precio.toFixed(2)),
            vigente_desde: fechaADb(desde),
          },
        });
        const anterior = existentes.find((e) => plan.cerrar.some((x) => x.id === e.id));
        await this.auditoria.registrar(tx, {
          accion: 'tarifa.crear',
          tabla: 'tarifa',
          registroId: nueva.id,
          antes: anterior ? { id: anterior.id, precio: anterior.precio, desde: fechaDeDb(anterior.vigente_desde) } : null,
          despues: { precio: nueva.precio, desde, cerradas: plan.cerrar },
        });
        return { id: nueva.id, precio: nueva.precio.toFixed(2), desde, cerradas: plan.cerrar };
      });
    } catch (e) {
      traducir(e, 'Ya hay una tarifa con esa fecha de inicio');
    }
  }

  private fecha(fecha?: string): string {
    if (fecha === undefined) return hoyLima();
    if (!esFecha(fecha)) throw new BadRequestException('Fecha no válida; usa AAAA-MM-DD');
    return fecha;
  }

  private async validarClave(c: ContextoSucursal, k: ClaveTarifa) {
    const [tipo, canal, turno] = await Promise.all([
      this.prisma.tipo_habitacion.findFirst({ where: { id: k.tipoId, empresa_id: c.empresaId, activo: true } }),
      this.prisma.canal_venta.findFirst({ where: { id: k.canalId, empresa_id: c.empresaId, activo: true } }),
      this.prisma.turno.findFirst({ where: { id: k.turnoId, activo: true } }),
    ]);
    if (!tipo) throw new BadRequestException('El tipo de habitación no existe o está inactivo');
    if (!canal) throw new BadRequestException('El canal de venta no existe o está inactivo');
    if (!turno) throw new BadRequestException('El turno no existe o está inactivo');
  }
}
