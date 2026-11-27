import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { AvisosTablero } from './avisos-tablero.service';
import { Franja, minutosDe, Operacion, OPERACION_POR_DEFECTO, ReglaOperacionError, validarFranjas, validarMinutosLimpieza } from '../domain/operacion';

const aHora = (t: Date) => t.toISOString().slice(11, 16);
const aTime = (h: string) => new Date(`1970-01-01T${h}:00Z`);

/** Cómo trabaja la sucursal (spec 2026-11-26 operación real): cobro al ingreso, consumos, limpieza, salida de la noche y franjas. */
@Injectable()
export class OperacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly avisos: AvisosTablero,
  ) {}

  async obtener(sucursalId: number): Promise<Operacion & { configurada: boolean }> {
    const [op, franjas] = await Promise.all([
      this.prisma.sucursal_operacion.findUnique({ where: { sucursal_id: sucursalId } }),
      this.prisma.sucursal_franja_salida.findMany({ where: { sucursal_id: sucursalId }, orderBy: { desde: 'asc' } }),
    ]);
    if (!op) return { ...OPERACION_POR_DEFECTO, configurada: false };
    return {
      configurada: true,
      cobroAlIngreso: op.cobro_al_ingreso,
      vendeConsumos: op.vende_consumos,
      minutosLimpieza: op.minutos_limpieza,
      horaSalidaNoche: aHora(op.hora_salida_noche),
      turnoSugeridoId: op.turno_sugerido_id,
      franjas: franjas.map((f) => ({ nombre: f.nombre, desde: aHora(f.desde), hasta: aHora(f.hasta), salidaMaxima: aHora(f.salida_maxima), diasDespues: f.dias_despues })),
    };
  }

  async guardar(sucursalId: number, d: Omit<Operacion, 'horaSalidaNoche'> & { horaSalidaNoche: string }) {
    let franjas: Franja[];
    try {
      validarMinutosLimpieza(d.minutosLimpieza);
      minutosDe(d.horaSalidaNoche);
      franjas = validarFranjas(d.franjas);
    } catch (e) {
      if (e instanceof ReglaOperacionError) throw new BadRequestException(e.message);
      throw e;
    }
    if (d.turnoSugeridoId !== null && !(await this.prisma.turno.findFirst({ where: { id: d.turnoSugeridoId, activo: true } }))) {
      throw new BadRequestException('El turno sugerido no existe o está inactivo');
    }
    const antes = await this.obtener(sucursalId);
    await this.prisma.$transaction(async (tx) => {
      const datos = {
        cobro_al_ingreso: d.cobroAlIngreso, vende_consumos: d.vendeConsumos, minutos_limpieza: d.minutosLimpieza,
        hora_salida_noche: aTime(d.horaSalidaNoche), turno_sugerido_id: d.turnoSugeridoId,
      };
      await tx.sucursal_operacion.upsert({ where: { sucursal_id: sucursalId }, create: { sucursal_id: sucursalId, ...datos }, update: datos });
      await tx.sucursal_franja_salida.deleteMany({ where: { sucursal_id: sucursalId } });
      if (franjas.length) {
        await tx.sucursal_franja_salida.createMany({
          data: franjas.map((f) => ({ sucursal_id: sucursalId, nombre: f.nombre, desde: aTime(f.desde), hasta: aTime(f.hasta), salida_maxima: aTime(f.salidaMaxima), dias_despues: f.diasDespues })),
        });
      }
      await this.auditoria.registrar(tx, { accion: 'operacion.configurar', tabla: 'sucursal_operacion', registroId: sucursalId, antes, despues: { ...d, franjas } });
    });
    // El tablero muestra el tiempo de limpieza con este valor
    await this.avisos.avisar(sucursalId, 'estado');
    return this.obtener(sucursalId);
  }
}
