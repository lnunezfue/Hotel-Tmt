import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsuarioSesion } from '../../../common/usuario-actual.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';

type Tx = Prisma.TransactionClient;

export type ConceptoCaja = 'VENTA' | 'ADELANTO_RESERVA' | 'INGRESO_FONDOS' | 'OTRO_INGRESO' | 'DEVOLUCION' | 'GASTO' | 'RETIRO' | 'OTRO_EGRESO';
export const CONCEPTOS_MANUALES = ['INGRESO_FONDOS', 'OTRO_INGRESO', 'GASTO', 'RETIRO', 'OTRO_EGRESO'] as const;

/**
 * Caja de recepción (spec S-07 §5): apertura, movimientos y cierre con arqueo. Una caja tiene a lo sumo una
 * sesión abierta (índice único de la base); los cobros del check-out y los adelantos entran a la sesión abierta
 * de la sucursal.
 */
@Injectable()
export class CajaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Sesión abierta de alguna caja de la sucursal; null si nadie abrió caja. */
  sesionAbierta(db: Tx | PrismaService, sucursalId: number) {
    return db.caja_sesion.findFirst({ where: { estado: 'ABIERTA', caja: { sucursal_id: sucursalId } }, orderBy: { fecha_apertura: 'asc' } });
  }

  async exigirSesion(db: Tx | PrismaService, sucursalId: number) {
    const s = await this.sesionAbierta(db, sucursalId);
    if (!s) throw new ConflictException({ message: 'La caja está cerrada. Ábrela en «Caja» para registrar cobros.', codigo: 'CAJA_CERRADA' });
    return s;
  }

  async registrar(
    tx: Tx,
    d: { sesionId: bigint; concepto: ConceptoCaja; metodoPagoId: number; monto: Prisma.Decimal | string | number; usuarioId: number; reservaId?: bigint | null; comprobantePagoId?: bigint | null; descripcion?: string | null },
  ) {
    const concepto = await tx.concepto_movimiento.findUniqueOrThrow({ where: { ambito_codigo: { ambito: 'CAJA', codigo: d.concepto } } });
    return tx.caja_movimiento.create({
      data: {
        caja_sesion_id: d.sesionId, concepto_movimiento_id: concepto.id, metodo_pago_id: d.metodoPagoId, monto: new Prisma.Decimal(d.monto),
        usuario_id: d.usuarioId, reserva_id: d.reservaId ?? null, comprobante_pago_id: d.comprobantePagoId ?? null, descripcion: d.descripcion ?? null,
      },
    });
  }

  metodos() {
    return this.prisma.metodo_pago.findMany({ where: { activo: true }, select: { id: true, codigo: true, descripcion: true, es_efectivo: true }, orderBy: { id: 'asc' } });
  }

  /** Estado de la caja de la sucursal: sesión abierta con sus movimientos y totales por método. */
  async actual(actor: UsuarioSesion) {
    const cajas = await this.prisma.caja.findMany({ where: { sucursal_id: actor.sucursalId, activo: true }, select: { id: true, nombre: true } });
    const s = await this.sesionAbierta(this.prisma, actor.sucursalId);
    const ultima = await this.prisma.caja_sesion.findFirst({
      where: { estado: 'CERRADA', caja: { sucursal_id: actor.sucursalId } },
      orderBy: { fecha_cierre: 'desc' },
      include: { usuario: { select: { nombres: true, apellidos: true } } },
    });
    return {
      cajas,
      sesion: s ? await this.resumen(s.id) : null,
      ultimoCierre: ultima
        ? { id: Number(ultima.id), cierre: ultima.fecha_cierre, esperado: ultima.monto_cierre_sistema?.toFixed(2), declarado: ultima.monto_cierre_declarado?.toFixed(2), diferencia: ultima.diferencia?.toFixed(2), usuario: `${ultima.usuario.nombres} ${ultima.usuario.apellidos}` }
        : null,
    };
  }

  async resumen(sesionId: bigint) {
    const s = await this.prisma.caja_sesion.findUniqueOrThrow({
      where: { id: sesionId },
      include: {
        caja: { select: { id: true, nombre: true } },
        usuario: { select: { nombres: true, apellidos: true } },
        caja_movimiento: {
          orderBy: { fecha_hora: 'desc' },
          include: { concepto_movimiento: { include: { tipo_movimiento: true } }, metodo_pago: true, reserva: { select: { codigo: true } }, usuario: { select: { username: true } } },
        },
      },
    });
    const porMetodo = new Map<string, { metodo: string; ingresos: number; egresos: number; efectivo: boolean }>();
    let efectivo = Number(s.monto_apertura);
    for (const m of s.caja_movimiento) {
      const signo = m.concepto_movimiento.tipo_movimiento.signo;
      const fila = porMetodo.get(m.metodo_pago.codigo) ?? { metodo: m.metodo_pago.descripcion, ingresos: 0, egresos: 0, efectivo: m.metodo_pago.es_efectivo };
      if (signo > 0) fila.ingresos += Number(m.monto);
      else fila.egresos += Number(m.monto);
      porMetodo.set(m.metodo_pago.codigo, fila);
      if (m.metodo_pago.es_efectivo) efectivo += signo * Number(m.monto);
    }
    return {
      id: Number(s.id),
      caja: s.caja,
      usuario: `${s.usuario.nombres} ${s.usuario.apellidos}`,
      apertura: s.fecha_apertura,
      montoApertura: s.monto_apertura.toFixed(2),
      estado: s.estado,
      efectivoEsperado: efectivo.toFixed(2),
      porMetodo: [...porMetodo.entries()].map(([codigo, f]) => ({ codigo, metodo: f.metodo, efectivo: f.efectivo, ingresos: f.ingresos.toFixed(2), egresos: f.egresos.toFixed(2) })),
      movimientos: s.caja_movimiento.map((m) => ({
        id: Number(m.id),
        fecha: m.fecha_hora,
        concepto: m.concepto_movimiento.descripcion,
        codigo: m.concepto_movimiento.codigo,
        tipo: m.concepto_movimiento.tipo_movimiento.signo > 0 ? 'INGRESO' : 'EGRESO',
        metodo: m.metodo_pago.descripcion,
        monto: m.monto.toFixed(2),
        descripcion: m.descripcion,
        reserva: m.reserva?.codigo ?? null,
        usuario: m.usuario.username,
      })),
    };
  }

  async abrir(actor: UsuarioSesion, d: { cajaId?: number; monto: number }) {
    if (!(d.monto >= 0)) throw new BadRequestException('El monto de apertura no puede ser negativo');
    const caja = await this.prisma.caja.findFirst({ where: { sucursal_id: actor.sucursalId, activo: true, ...(d.cajaId && { id: d.cajaId }) }, orderBy: { id: 'asc' } });
    if (!caja) throw new BadRequestException('La sucursal no tiene una caja activa');
    if (await this.sesionAbierta(this.prisma, actor.sucursalId)) throw new ConflictException('Ya hay una caja abierta en la sucursal');
    try {
      const s = await this.prisma.$transaction(async (tx) => {
        const nueva = await tx.caja_sesion.create({ data: { caja_id: caja.id, usuario_id: actor.sub, monto_apertura: new Prisma.Decimal(d.monto.toFixed(2)) } });
        await this.auditoria.registrar(tx, { accion: 'caja.abrir', tabla: 'caja_sesion', registroId: nueva.id, despues: { caja: caja.nombre, monto: d.monto } });
        return nueva;
      });
      return this.resumen(s.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Esa caja ya está abierta');
      throw e;
    }
  }

  /** Gasto, retiro o ingreso de fondos en efectivo durante el turno. */
  async movimientoManual(actor: UsuarioSesion, d: { concepto: (typeof CONCEPTOS_MANUALES)[number]; monto: number; descripcion: string }) {
    if (!(d.monto > 0)) throw new BadRequestException('El monto debe ser mayor que cero');
    const efectivo = await this.prisma.metodo_pago.findUniqueOrThrow({ where: { codigo: 'EFECTIVO' } });
    const s = await this.exigirSesion(this.prisma, actor.sucursalId);
    await this.prisma.$transaction(async (tx) => {
      const m = await this.registrar(tx, { sesionId: s.id, concepto: d.concepto, metodoPagoId: efectivo.id, monto: d.monto.toFixed(2), usuarioId: actor.sub, descripcion: d.descripcion.trim() });
      await this.auditoria.registrar(tx, { accion: 'caja.movimiento', tabla: 'caja_movimiento', registroId: m.id, despues: { concepto: d.concepto, monto: d.monto, descripcion: d.descripcion } });
    });
    return this.resumen(s.id);
  }

  /** Arqueo: el sistema calcula el efectivo esperado (sp_cerrar_caja) y se guarda la diferencia con lo contado. */
  async cerrar(actor: UsuarioSesion, montoDeclarado: number) {
    if (!(montoDeclarado >= 0)) throw new BadRequestException('Indica el efectivo contado');
    const s = await this.exigirSesion(this.prisma, actor.sucursalId);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`CALL sp_cerrar_caja(${s.id}, ${montoDeclarado.toFixed(2)})`;
      const c = await tx.caja_sesion.findUniqueOrThrow({ where: { id: s.id } });
      await this.auditoria.registrar(tx, {
        accion: 'caja.cerrar',
        tabla: 'caja_sesion',
        registroId: s.id,
        despues: { esperado: c.monto_cierre_sistema, declarado: c.monto_cierre_declarado, diferencia: c.diferencia },
      });
    });
    const r = await this.resumen(s.id);
    const c = await this.prisma.caja_sesion.findUniqueOrThrow({ where: { id: s.id } });
    return { ...r, cierre: c.fecha_cierre, esperado: c.monto_cierre_sistema?.toFixed(2), declarado: c.monto_cierre_declarado?.toFixed(2), diferencia: c.diferencia?.toFixed(2) };
  }
}
