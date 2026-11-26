import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequierePermiso } from '../auth/permisos.decorator';
import { Auditar } from '../auditoria/auditar.decorator';
import { UsuarioActual, UsuarioSesion } from '../../common/usuario-actual.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ConfiguracionService, ContextoSucursal } from './application/configuracion.service';
import { OperacionService } from './application/operacion.service';

const Id = z.coerce.number().int().positive();
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa AAAA-MM-DD');
const conCambios = <T extends z.ZodRawShape>(s: z.ZodObject<T>) => s.partial().refine((o) => Object.keys(o).length > 0, 'No hay cambios');

const PisoSchema = z.object({ numero: z.number().int().min(-5).max(200), nombre: z.string().trim().min(1).max(50) });
const EditarPisoSchema = conCambios(z.object({ nombre: z.string().trim().min(1).max(50), activo: z.boolean() }));
const TipoBase = z.object({
  nombre: z.string().trim().min(2).max(60),
  descripcion: z.string().max(300).nullable().optional(),
  capacidadAdultos: z.number().int().min(1).max(20),
  capacidadNinos: z.number().int().min(0).max(20),
});
const TipoSchema = TipoBase.extend({ capacidadNinos: z.number().int().min(0).max(20).default(0) });
const EditarTipoSchema = conCambios(TipoBase.extend({ activo: z.boolean() }));
const EditarHabitacionSchema = conCambios(
  z.object({
    numero: z.string().trim().min(1).max(10),
    pisoId: z.number().int().positive(),
    tipoHabitacionId: z.number().int().positive(),
    descripcion: z.string().max(300).nullable(),
    activo: z.boolean(),
  }),
);
// Longitud, rango y decimales los valida el dominio (canal-venta.ts, turno.ts); aquí solo la forma.
const TurnoSchema = z.object({ nombre: z.string().max(200), duracionHoras: z.number() });
const EditarTurnoSchema = conCambios(z.object({ nombre: z.string().max(200), duracionHoras: z.number(), activo: z.boolean() }));
const CanalSchema = z.object({ nombre: z.string().max(200), comisionPorcentaje: z.number(), esOta: z.boolean().default(false) });
const EditarCanalSchema = conCambios(z.object({ nombre: z.string().max(200), comisionPorcentaje: z.number(), esOta: z.boolean(), activo: z.boolean() }));
const ClaveTarifaSchema =z.object({ tipoId: Id, canalId: Id, turnoId: Id });
const NuevaTarifaSchema = z.object({
  tipoId: z.number().int().positive(),
  canalId: z.number().int().positive(),
  turnoId: z.number().int().positive(),
  precio: z.number(),
  desde: Fecha.optional(),
});
const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa HH:MM');
// Las reglas (cruces, topes) las valida el dominio (operacion.ts); aquí solo la forma.
const OperacionSchema = z.object({
  cobroAlIngreso: z.boolean(),
  vendeConsumos: z.boolean(),
  minutosLimpieza: z.number().int(),
  horaSalidaNoche: Hora,
  turnoSugeridoId: z.number().int().positive().nullable(),
  franjas: z.array(z.object({ nombre: z.string().max(60), desde: Hora, hasta: Hora, salidaMaxima: Hora, diasDespues: z.number().int() })).max(8),
});
const FechaQuery = z.object({ fecha: Fecha.optional() });

const ctx = (u: UsuarioSesion): ContextoSucursal => ({ empresaId: u.empresaId, sucursalId: u.sucursalId });

/** Configuración del hotel para la sucursal del token (spec S-04 §5). */
@ApiTags('hospedaje · configuración')
@Controller('hospedaje')
export class ConfiguracionController {
  constructor(
    private readonly svc: ConfiguracionService,
    private readonly operacion: OperacionService,
  ) {}

  /** Lo lee cualquier usuario de la sucursal: recepción necesita saber si cobra al ingreso y las horas de salida. */
  @Get('operacion')
  verOperacion(@UsuarioActual() u: UsuarioSesion) {
    return this.operacion.obtener(u.sucursalId);
  }

  @RequierePermiso('operacion.configurar')
  @Auditar('operacion.configurar')
  @Put('operacion')
  guardarOperacion(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(OperacionSchema)) body: z.infer<typeof OperacionSchema>) {
    return this.operacion.guardar(u.sucursalId, body);
  }

  @RequierePermiso('habitacion.gestionar')
  @Get('config/habitaciones')
  habitaciones(@UsuarioActual() u: UsuarioSesion) {
    return this.svc.habitaciones(ctx(u));
  }

  @RequierePermiso('habitacion.gestionar')
  @Auditar('habitacion.editar')
  @Patch('habitaciones/:id')
  editarHabitacion(
    @UsuarioActual() u: UsuarioSesion,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(EditarHabitacionSchema)) body: z.infer<typeof EditarHabitacionSchema>,
  ) {
    return this.svc.editarHabitacion(ctx(u), id, body);
  }

  @RequierePermiso('habitacion.gestionar')
  @Get('config/pisos')
  pisos(@UsuarioActual() u: UsuarioSesion) {
    return this.svc.pisos(ctx(u));
  }

  @RequierePermiso('habitacion.gestionar')
  @Auditar('piso.crear')
  @Post('pisos')
  crearPiso(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(PisoSchema)) body: z.infer<typeof PisoSchema>) {
    return this.svc.crearPiso(ctx(u), body);
  }

  @RequierePermiso('habitacion.gestionar')
  @Auditar('piso.editar')
  @Patch('pisos/:id')
  editarPiso(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(EditarPisoSchema)) body: z.infer<typeof EditarPisoSchema>) {
    return this.svc.editarPiso(ctx(u), id, body);
  }

  @RequierePermiso('habitacion.gestionar')
  @Get('config/tipos-habitacion')
  tipos(@UsuarioActual() u: UsuarioSesion) {
    return this.svc.tipos(ctx(u));
  }

  @RequierePermiso('habitacion.gestionar')
  @Auditar('tipo_habitacion.crear')
  @Post('tipos-habitacion')
  crearTipo(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(TipoSchema)) body: z.infer<typeof TipoSchema>) {
    return this.svc.crearTipo(ctx(u), body);
  }

  @RequierePermiso('habitacion.gestionar')
  @Auditar('tipo_habitacion.editar')
  @Patch('tipos-habitacion/:id')
  editarTipo(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(EditarTipoSchema)) body: z.infer<typeof EditarTipoSchema>) {
    return this.svc.editarTipo(ctx(u), id, body);
  }

  @Get('canales')
  canales(@UsuarioActual() u: UsuarioSesion) {
    return this.svc.canales(ctx(u));
  }

  @RequierePermiso('habitacion.gestionar')
  @Get('config/canales')
  canalesConfig(@UsuarioActual() u: UsuarioSesion) {
    return this.svc.canalesConfig(ctx(u));
  }

  /** La comisión es una condición comercial, como el precio: se edita con el permiso de tarifas (RF-RES-07). */
  @RequierePermiso('tarifa.editar')
  @Auditar('canal_venta.crear')
  @Post('canales')
  crearCanal(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(CanalSchema)) body: z.infer<typeof CanalSchema>) {
    return this.svc.crearCanal(ctx(u), body);
  }

  @RequierePermiso('tarifa.editar')
  @Auditar('canal_venta.editar')
  @Patch('canales/:id')
  editarCanal(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(EditarCanalSchema)) body: z.infer<typeof EditarCanalSchema>) {
    return this.svc.editarCanal(ctx(u), id, body);
  }

  @Get('turnos')
  turnos() {
    return this.svc.turnos();
  }

  @RequierePermiso('habitacion.gestionar')
  @Get('config/turnos')
  turnosConfig(@UsuarioActual() u: UsuarioSesion) {
    return this.svc.turnosConfig(ctx(u));
  }

  /** Los turnos son comunes a todo el sistema y definen qué se vende: se editan con el permiso de tarifas (RF-RES-08). */
  @RequierePermiso('tarifa.editar')
  @Auditar('turno.crear')
  @Post('turnos')
  crearTurno(@Body(new ZodValidationPipe(TurnoSchema)) body: z.infer<typeof TurnoSchema>) {
    return this.svc.crearTurno(body);
  }

  @RequierePermiso('tarifa.editar')
  @Auditar('turno.editar')
  @Patch('turnos/:id')
  editarTurno(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(EditarTurnoSchema)) body: z.infer<typeof EditarTurnoSchema>) {
    return this.svc.editarTurno(id, body);
  }

  @Get('tarifas')
  tarifas(@UsuarioActual() u: UsuarioSesion, @Query(new ZodValidationPipe(FechaQuery)) q: z.infer<typeof FechaQuery>) {
    return this.svc.tarifas(ctx(u), q.fecha);
  }

  @Get('tarifas/vigente')
  vigente(@UsuarioActual() u: UsuarioSesion, @Query(new ZodValidationPipe(ClaveTarifaSchema.merge(FechaQuery))) q: z.infer<typeof ClaveTarifaSchema> & { fecha?: string }) {
    return this.svc.precioVigente(ctx(u), q, q.fecha);
  }

  @Get('tarifas/historial')
  historial(@UsuarioActual() u: UsuarioSesion, @Query(new ZodValidationPipe(ClaveTarifaSchema)) q: z.infer<typeof ClaveTarifaSchema>) {
    return this.svc.historialTarifa(ctx(u), q);
  }

  @RequierePermiso('tarifa.editar')
  @Auditar('tarifa.crear')
  @Post('tarifas')
  crearTarifa(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(NuevaTarifaSchema)) body: z.infer<typeof NuevaTarifaSchema>) {
    return this.svc.crearTarifa(ctx(u), body);
  }
}
