import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { HabitacionRepository } from '../infrastructure/habitacion.repository';
import { alertaSalida, esEstado, EstadoHabitacion, TransicionInvalidaError, transicionesPermitidas, validarTransicion } from '../domain/estado-habitacion';

@Injectable()
export class HospedajeService {
  constructor(
    private readonly repo: HabitacionRepository,
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async tablero(sucursalId: number) {
    const pisos = await this.repo.tablero(sucursalId);
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
        return {
          id: h.id,
          numero: h.numero,
          tipo: h.tipo_habitacion.nombre,
          capacidad: h.tipo_habitacion.capacidad_adultos,
          estado: codigo,
          estadoDescripcion: h.estado_habitacion.descripcion,
          color: h.estado_habitacion.color_hex,
          siguientes: transicionesPermitidas(codigo),
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
    try {
      validarTransicion(hab.estado_habitacion.codigo as EstadoHabitacion, nuevo);
    } catch (e) {
      if (e instanceof TransicionInvalidaError) throw new ConflictException(e.message);
      throw e;
    }
    const estado = await this.prisma.estado_habitacion.findUniqueOrThrow({ where: { codigo: nuevo } });
    await this.repo.cambiarEstado(habitacionId, estado.id, usuarioId, motivo);
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

  async crearHabitacion(sucursalId: number, empresaId: number, d: { numero: string; pisoId: number; tipoHabitacionId: number; descripcion?: string }) {
    const piso = await this.prisma.piso.findFirst({ where: { id: d.pisoId, sucursal_id: sucursalId, activo: true } });
    if (!piso) throw new BadRequestException('El piso no pertenece a tu sucursal o está inactivo');
    const tipo = await this.prisma.tipo_habitacion.findFirst({ where: { id: d.tipoHabitacionId, empresa_id: empresaId, activo: true } });
    if (!tipo) throw new BadRequestException('El tipo de habitación no existe o está inactivo');
    const existe = await this.prisma.habitacion.findFirst({ where: { sucursal_id: sucursalId, numero: d.numero } });
    if (existe) throw new ConflictException(`Ya existe la habitación ${d.numero} en esta sucursal`);
    const desocupada = await this.prisma.estado_habitacion.findUniqueOrThrow({ where: { codigo: 'DESOCUPADA' } });
    return this.prisma.$transaction(async (tx) => {
      const hab = await tx.habitacion.create({
        data: {
          sucursal_id: sucursalId, piso_id: d.pisoId, tipo_habitacion_id: d.tipoHabitacionId,
          estado_habitacion_id: desocupada.id, numero: d.numero, descripcion: d.descripcion ?? null,
        },
      });
      await this.auditoria.registrar(tx, { accion: 'habitacion.crear', tabla: 'habitacion', registroId: hab.id, despues: hab });
      return hab;
    });
  }
}
