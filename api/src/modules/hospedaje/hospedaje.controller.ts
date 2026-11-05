import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { HospedajeService } from './application/hospedaje.service';
import { RequierePermiso } from '../auth/permisos.decorator';
import { UsuarioActual, UsuarioSesion } from '../../common/usuario-actual.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Auditar } from '../auditoria/auditar.decorator';
import { ESTADOS } from './domain/estado-habitacion';

const CambioEstadoSchema = z.object({ estado: z.enum(ESTADOS), motivo: z.string().max(200).optional() });
const HabitacionSchema = z.object({
  numero: z.string().min(1).max(10),
  pisoId: z.number().int().positive(),
  tipoHabitacionId: z.number().int().positive(),
  descripcion: z.string().max(300).optional(),
});

@ApiTags('hospedaje')
@Controller('hospedaje')
export class HospedajeController {
  constructor(private readonly svc: HospedajeService) {}

  /** Tablero de habitaciones por piso (RF-RES-05). La sucursal sale del token, nunca del navegador. */
  @Get('tablero')
  tablero(@UsuarioActual() u: UsuarioSesion) {
    return this.svc.tablero(u.sucursalId);
  }

  @RequierePermiso('habitacion.cambiar_estado')
  @Patch('habitaciones/:id/estado')
  cambiarEstado(
    @UsuarioActual() u: UsuarioSesion,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(CambioEstadoSchema)) body: z.infer<typeof CambioEstadoSchema>,
  ) {
    return this.svc.cambiarEstado(u.sucursalId, u.sub, id, body.estado, body.motivo ?? null);
  }

  @Get('habitaciones/:id/historial')
  historial(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.svc.historial(u.sucursalId, id);
  }

  @RequierePermiso('habitacion.gestionar')
  @Auditar('habitacion.crear')
  @Post('habitaciones')
  crear(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(HabitacionSchema)) body: z.infer<typeof HabitacionSchema>) {
    return this.svc.crearHabitacion(u.sucursalId, body);
  }

  @Get('estados')
  estados() {
    return this.svc.estados();
  }

  @Get('pisos')
  pisos(@UsuarioActual() u: UsuarioSesion) {
    return this.svc.pisos(u.sucursalId);
  }

  @Get('tipos-habitacion')
  tipos(@UsuarioActual() u: UsuarioSesion) {
    return this.svc.tiposHabitacion(u.empresaId);
  }
}
