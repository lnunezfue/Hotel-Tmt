import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Rect, ReglaPlanoError, validarPlano } from '../domain/plano';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { HabitacionRepository } from '../infrastructure/habitacion.repository';
import { AvisosTablero } from './avisos-tablero.service';
import { OperacionService } from './operacion.service';
import { estadoLimpieza } from '../domain/operacion';
import { alertaSalida, esEstado, EstadoHabitacion, TransicionInvalidaError, transicionesPermitidas, validarTransicion } from '../domain/estado-habitacion';

@Injectable()
export class HospedajeService {
  constructor(
    private readonly repo: HabitacionRepository,
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly avisos: AvisosTablero,
    private readonly operacion: OperacionService,
  ) {}

  async tablero(sucursalId: number) {
    const [pisos, op] = await Promise.all([this.repo.tablero(sucursalId), this.operacion.obtener(sucursalId)]);
    const ahora = new Date();
    const resumen: Record<string, number> = {};
    const data = pisos.map((p) => ({
      id: p.id,
      numero: p.numero,
      nombre: p.nombre,
      habitaciones: p.habitacion.map((h) => {
        const est = h.estancia[0];
        const codigo = h.estado_habitacion.codigo as EstadoHabitacion;
        resumen[codigo] = (resumen[codigo] ?? 0) + 1;
        const desde = h.habitacion_estado_historial[0]?.fecha_hora ?? null;
        return {
          id: h.id,
          numero: h.numero,
          tipo: h.tipo_habitacion.nombre,
          tipoId: h.tipo_habitacion.id,
          capacidad: h.tipo_habitacion.capacidad_adultos,
          estado: codigo,
          estadoDescripcion: h.estado_habitacion.descripcion,
          color: h.estado_habitacion.color_hex,
          estadoDesde: desde,
          limpieza: codigo === 'LIMPIEZA' && desde ? { ...estadoLimpieza(desde, ahora, op.minutosLimpieza), esperados: op.minutosLimpieza } : null,
          // OCUPADA entra con el check-in y sale con el check-out o el traslado: no se ofrece a mano.
          siguientes: est ? [] : transicionesPermitidas(codigo).filter((x) => x !== 'OCUPADA'),
          estancia: est
            ? {
                id: Number(est.id),
                huesped: est.estancia_huesped[0]?.cliente.nombre_completo ?? null,
                checkin: est.checkin_at,
                salidaPrevista: est.checkout_previsto,
                alerta: alertaSalida(est.checkout_previsto, ahora),
              }
            : null,
        };
      }),
    }));
    return { generadoEn: ahora, resumen, pisos: data };
  }

  async cambiarEstado(sucursalId: number, usuarioId: number, habitacionId: number, nuevo: string, motivo: string | null) {
    if (!esEstado(nuevo)) throw new BadRequestException(`Estado desconocido: ${nuevo}`);
    const hab = await this.repo.buscar(sucursalId, habitacionId);
    if (!hab) throw new NotFoundException('La habitación no existe en tu sucursal');
    if (nuevo === 'OCUPADA') throw new ConflictException('La habitación se ocupa con el check-in');
    if (await this.prisma.estancia.count({ where: { habitacion_id: habitacionId, estado: 'ACTIVA' } })) {
      throw new ConflictException('La habitación tiene una estadía en curso: se libera con el check-out o el traslado');
    }
    try {
      validarTransicion(hab.estado_habitacion.codigo as EstadoHabitacion, nuevo);
    } catch (e) {
      if (e instanceof TransicionInvalidaError) throw new ConflictException(e.message);
      throw e;
    }
    const estado = await this.prisma.estado_habitacion.findUniqueOrThrow({ where: { codigo: nuevo } });
    await this.repo.cambiarEstado(habitacionId, estado.id, usuarioId, motivo);
    await this.avisos.avisar(sucursalId, 'estado');
    return { id: habitacionId, estado: nuevo };
  }

  async historial(sucursalId: number, habitacionId: number) {
    const filas = await this.repo.historial(sucursalId, habitacionId);
    return filas.map((f) => ({
      id: Number(f.id), fecha: f.fecha_hora, motivo: f.motivo, usuario: f.usuario?.username ?? null,
      desde: f.estado_anterior?.codigo ?? null, hacia: f.estado_nuevo.codigo,
    }));
  }

  estados() {
    return this.prisma.estado_habitacion.findMany({ orderBy: { orden: 'asc' } });
  }

  pisos(sucursalId: number) {
    return this.prisma.piso.findMany({ where: { sucursal_id: sucursalId }, orderBy: { numero: 'asc' } });
  }

  tiposHabitacion(empresaId: number) {
    return this.prisma.tipo_habitacion.findMany({ where: { empresa_id: empresaId, activo: true }, orderBy: { id: 'asc' } });
  }

  async crearHabitacion(
    sucursalId: number,
    empresaId: number,
    d: { numero: string; pisoId: number; tipoHabitacionId: number; descripcion?: string; plano?: Rect; amenidades?: string[] },
  ) {
    const piso = await this.prisma.piso.findFirst({ where: { id: d.pisoId, sucursal_id: sucursalId, activo: true } });
    if (!piso) throw new BadRequestException('El piso no pertenece a tu sucursal o está inactivo');
    const tipo = await this.prisma.tipo_habitacion.findFirst({ where: { id: d.tipoHabitacionId, empresa_id: empresaId, activo: true } });
    if (!tipo) throw new BadRequestException('El tipo de habitación no existe o está inactivo');
    const existe = await this.prisma.habitacion.findFirst({ where: { sucursal_id: sucursalId, numero: d.numero } });
    if (existe) throw new ConflictException(`Ya existe la habitación ${d.numero} en esta sucursal`);
    if (d.plano) await this.validarHueco(piso.id, piso.plano_columnas, piso.plano_filas, d.numero, d.plano);
    const amenidades = d.amenidades?.length
      ? await this.prisma.amenidad.findMany({ where: { empresa_id: empresaId, codigo: { in: [...new Set(d.amenidades)] }, activo: true } })
      : [];
    if (d.amenidades && amenidades.length !== new Set(d.amenidades).size) throw new BadRequestException('Hay comodidades desconocidas o inactivas');
    const desocupada = await this.prisma.estado_habitacion.findUniqueOrThrow({ where: { codigo: 'DESOCUPADA' } });
    const creada = await this.prisma.$transaction(async (tx) => {
      const hab = await tx.habitacion.create({
        data: {
          sucursal_id: sucursalId, piso_id: d.pisoId, tipo_habitacion_id: d.tipoHabitacionId,
          estado_habitacion_id: desocupada.id, numero: d.numero, descripcion: d.descripcion ?? null,
          ...(d.plano && { plano_x: d.plano.x, plano_y: d.plano.y, plano_ancho: d.plano.ancho, plano_alto: d.plano.alto }),
          habitacion_amenidad: { create: amenidades.map((a) => ({ amenidad_id: a.id })) },
        },
      });
      await this.auditoria.registrar(tx, { accion: 'habitacion.crear', tabla: 'habitacion', registroId: hab.id, despues: hab });
      return hab;
    });
    await this.avisos.avisar(sucursalId, 'habitacion');
    return creada;
  }

  /** La habitación nueva debe caber en el plano sin pisar otra habitación ni un elemento (S-06 §4). */
  private async validarHueco(pisoId: number, columnas: number, filas: number, numero: string, r: Rect) {
    const [habs, elems] = await Promise.all([
      this.prisma.habitacion.findMany({ where: { piso_id: pisoId, activo: true, plano_x: { not: null } } }),
      this.prisma.plano_elemento.findMany({ where: { piso_id: pisoId } }),
    ]);
    try {
      validarPlano(columnas, filas, [
        { ...r, nombre: `habitación ${numero}` },
        ...habs.map((h) => ({ x: h.plano_x!, y: h.plano_y!, ancho: h.plano_ancho, alto: h.plano_alto, nombre: `habitación ${h.numero}` })),
        ...elems.map((e) => ({ x: e.x, y: e.y, ancho: e.ancho, alto: e.alto, nombre: e.etiqueta ?? e.tipo.toLowerCase().replace('_', ' ') })),
      ]);
    } catch (e) {
      if (e instanceof ReglaPlanoError) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
