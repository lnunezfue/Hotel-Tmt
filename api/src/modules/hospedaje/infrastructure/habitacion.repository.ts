import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Repositorio de habitaciones. El filtro por sucursal se aplica aquí, no en cada endpoint (DT-001 §4.4).
 */
@Injectable()
export class HabitacionRepository {
  constructor(private readonly prisma: PrismaService) {}

  tablero(sucursalId: number) {
    return this.prisma.piso.findMany({
      where: { sucursal_id: sucursalId, activo: true },
      orderBy: { numero: 'asc' },
      select: {
        id: true, numero: true, nombre: true,
        habitacion: {
          where: { activo: true },
          orderBy: { numero: 'asc' },
          select: {
            id: true, numero: true, descripcion: true,
            tipo_habitacion: { select: { id: true, nombre: true, capacidad_adultos: true } },
            estado_habitacion: { select: { codigo: true, descripcion: true, color_hex: true } },
            estancia: {
              where: { estado: 'ACTIVA' },
              take: 1,
              select: {
                id: true, checkin_at: true, checkout_previsto: true,
                estancia_huesped: { where: { es_titular: true }, select: { cliente: { select: { nombre_completo: true } } } },
              },
            },
          },
        },
      },
    });
  }

  buscar(sucursalId: number, habitacionId: number) {
    return this.prisma.habitacion.findFirst({
      where: { id: habitacionId, sucursal_id: sucursalId },
      include: { estado_habitacion: true },
    });
  }

  /** Cambia el estado dentro de una transacción; el trigger trg_hab_au_estado guarda el historial con usuario y motivo. */
  cambiarEstado(habitacionId: number, estadoId: number, usuarioId: number, motivo: string | null) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET @app_usuario_id = ${usuarioId}, @app_motivo = ${motivo}`;
      return tx.habitacion.update({ where: { id: habitacionId }, data: { estado_habitacion_id: estadoId } });
    });
  }

  historial(sucursalId: number, habitacionId: number) {
    return this.prisma.habitacion_estado_historial.findMany({
      where: { habitacion_id: habitacionId, habitacion: { sucursal_id: sucursalId } },
      orderBy: { fecha_hora: 'desc' },
      take: 50,
      select: {
        id: true, fecha_hora: true, motivo: true,
        estado_anterior: { select: { codigo: true } },
        estado_nuevo: { select: { codigo: true } },
        usuario: { select: { username: true } },
      },
    });
  }
}
