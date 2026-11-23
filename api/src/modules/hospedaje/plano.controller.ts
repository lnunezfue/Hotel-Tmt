import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequierePermiso } from '../auth/permisos.decorator';
import { Auditar } from '../auditoria/auditar.decorator';
import { UsuarioActual, UsuarioSesion } from '../../common/usuario-actual.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PlanoService } from './application/plano.service';
import { ICONOS_AMENIDAD } from './domain/amenidad';

const Celda = z.number().int().min(0).max(30);
const Lado = z.number().int().min(1).max(30);
const Rect = z.object({ x: Celda, y: Celda, ancho: Lado, alto: Lado });
const PlanoPisoSchema = z.object({
  columnas: z.number().int(),
  filas: z.number().int(),
  habitaciones: z.array(Rect.extend({ id: z.number().int().positive(), ancho: z.number().int().min(1).max(10), alto: z.number().int().min(1).max(10) })).max(200),
  elementos: z
    .array(Rect.extend({ tipo: z.enum(['PASILLO', 'ESCALERA', 'ASCENSOR', 'RECEPCION', 'AREA_COMUN', 'BANO_COMUN']), etiqueta: z.string().max(40).nullable().optional() }))
    .max(100),
});
const PisoNuevoSchema = z.object({
  numero: z.number().int().min(-5).max(99),
  nombre: z.string().trim().min(1).max(50),
  habitaciones: z.number().int().min(0).max(16).default(0),
  tipoHabitacionId: z.number().int().positive().optional(),
});
const AmenidadSchema = z.object({ nombre: z.string().trim().min(2).max(60), icono: z.enum(ICONOS_AMENIDAD) });
const EditarAmenidadSchema = z
  .object({ nombre: z.string().trim().min(2).max(60), icono: z.enum(ICONOS_AMENIDAD), activo: z.boolean() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No hay cambios');
const AsignarSchema = z.object({ amenidades: z.array(z.string().min(1).max(30)).max(40), aplicarATipo: z.boolean().default(false) });

const ctx = (u: UsuarioSesion) => ({ empresaId: u.empresaId, sucursalId: u.sucursalId });

/** Plano visual del hotel y comodidades por habitación (spec S-06 §4). */
@ApiTags('hospedaje · plano')
@Controller('hospedaje')
export class PlanoController {
  constructor(private readonly svc: PlanoService) {}

  /** Lo ve cualquiera con sesión: es el tablero dibujado. Editar exige habitacion.gestionar. */
  @Get('plano')
  plano(@UsuarioActual() u: UsuarioSesion) {
    return this.svc.plano(ctx(u));
  }

  @RequierePermiso('habitacion.gestionar')
  @Auditar('plano.guardar')
  @Put('plano/pisos/:id')
  guardarPiso(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(PlanoPisoSchema)) body: z.infer<typeof PlanoPisoSchema>) {
    return this.svc.guardarPiso(ctx(u), id, body);
  }

  @RequierePermiso('habitacion.gestionar')
  @Auditar('piso.crear')
  @Post('plano/pisos')
  crearPiso(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(PisoNuevoSchema)) body: z.infer<typeof PisoNuevoSchema>) {
    return this.svc.crearPisoConPlano(ctx(u), body);
  }

  @Get('amenidades')
  amenidades(@UsuarioActual() u: UsuarioSesion) {
    return this.svc.amenidades(ctx(u));
  }

  @RequierePermiso('habitacion.gestionar')
  @Auditar('amenidad.crear')
  @Post('amenidades')
  crearAmenidad(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(AmenidadSchema)) body: z.infer<typeof AmenidadSchema>) {
    return this.svc.crearAmenidad(ctx(u), body);
  }

  @RequierePermiso('habitacion.gestionar')
  @Auditar('amenidad.editar')
  @Patch('amenidades/:id')
  editarAmenidad(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(EditarAmenidadSchema)) body: z.infer<typeof EditarAmenidadSchema>) {
    return this.svc.editarAmenidad(ctx(u), id, body);
  }

  @RequierePermiso('habitacion.gestionar')
  @Auditar('habitacion.amenidades')
  @Put('habitaciones/:id/amenidades')
  asignar(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(AsignarSchema)) body: z.infer<typeof AsignarSchema>) {
    return this.svc.asignarAmenidades(ctx(u), id, body.amenidades, body.aplicarATipo);
  }
}
