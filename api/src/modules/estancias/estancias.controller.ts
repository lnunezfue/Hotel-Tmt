import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequierePermiso } from '../auth/permisos.decorator';
import { Auditar } from '../auditoria/auditar.decorator';
import { UsuarioActual, UsuarioSesion } from '../../common/usuario-actual.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { EstanciasService } from './application/estancias.service';
import { ComprobantesService } from './application/comprobantes.service';
import { hoyLima } from '../hospedaje/domain/tarifa';

const Id = z.number().int().positive();
const CheckinSchema = z.object({
  habitacionId: Id, clienteId: Id, acompanantes: z.array(Id).max(10).default([]), canalId: Id, turnoId: Id,
  cantidad: z.number().int().min(1).max(60), procedencia: z.string().max(100).nullable().optional(), placa: z.string().max(10).nullable().optional(),
  destino: z.string().max(200).nullable().optional(), motivoViaje: z.string().max(40).nullable().optional(),
});
const ExtensionSchema = z.object({ turnos: z.number() });
const TrasladoSchema = z.object({ habitacionId: Id, motivo: z.string().max(400) });
const LibroSchema = z.object({ desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const HuespedSchema = z.object({ clienteId: Id });
const CargoSchema = z
  .object({ productoId: Id.optional(), descripcion: z.string().trim().max(200).optional(), cantidad: z.number().positive().max(999), precio: z.number().min(0).max(99_999).optional() })
  .refine((c) => c.productoId || (c.descripcion && c.precio !== undefined), 'Elige un producto o escribe la descripción y el precio');
const CheckoutSchema = z.object({
  tipoComprobante: z.enum(['BOLETA', 'FACTURA', 'INTERNO']),
  clienteId: Id.optional(),
  serieId: Id.optional(),
  descuento: z.object({ tipo: z.enum(['MONTO', 'PORCENTAJE']), valor: z.number(), motivo: z.string().max(400) }).optional(),
  pagos: z.array(z.object({ metodoPagoId: Id, monto: z.number().positive().max(999_999), referencia: z.string().max(60).nullable().optional() })).max(6),
});
const FechaSchema = z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/** Estadías en curso, consumos y check-out con cobro (spec S-07 §3–§4). */
@ApiTags('estancias')
@Controller()
export class EstanciasController {
  constructor(
    private readonly svc: EstanciasService,
    private readonly comprobantes: ComprobantesService,
  ) {}

  @Get('productos')
  productos(@UsuarioActual() u: UsuarioSesion) {
    return this.svc.productos(u.empresaId);
  }

  @Get('estancias/habitacion/:habitacionId')
  porHabitacion(@UsuarioActual() u: UsuarioSesion, @Param('habitacionId', ParseIntPipe) habitacionId: number) {
    return this.svc.porHabitacion(u.sucursalId, habitacionId);
  }

  @Get('estancias/:id')
  detalle(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.svc.detalle(u.sucursalId, id);
  }

  @RequierePermiso('estancia.checkin')
  @Auditar('estancia.checkin')
  @Post('estancias')
  checkin(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(CheckinSchema)) body: z.infer<typeof CheckinSchema>) {
    return this.svc.checkinDirecto(u, body);
  }

  @RequierePermiso('estancia.checkin')
  @Auditar('estancia.huesped')
  @Post('estancias/:id/huespedes')
  @HttpCode(200)
  huesped(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(HuespedSchema)) body: z.infer<typeof HuespedSchema>) {
    return this.svc.agregarHuesped(u, id, body.clienteId);
  }

  @RequierePermiso('estancia.checkin')
  @Auditar('estancia.extender')
  @Post('estancias/:id/extension')
  @HttpCode(200)
  extender(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(ExtensionSchema)) body: z.infer<typeof ExtensionSchema>) {
    return this.svc.extender(u, id, body.turnos);
  }

  @RequierePermiso('estancia.checkin')
  @Auditar('estancia.traslado')
  @Post('estancias/:id/traslado')
  @HttpCode(200)
  trasladar(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(TrasladoSchema)) body: z.infer<typeof TrasladoSchema>) {
    return this.svc.trasladar(u, id, body);
  }

  @RequierePermiso('estancia.checkin', 'reporte.ver')
  @Get('libro-huespedes')
  libro(@UsuarioActual() u: UsuarioSesion, @Query(new ZodValidationPipe(LibroSchema)) q: z.infer<typeof LibroSchema>) {
    return this.svc.libro(u.sucursalId, q.desde, q.hasta);
  }

  @RequierePermiso('estancia.checkout')
  @Auditar('estancia.cargo')
  @Post('estancias/:id/cargos')
  @HttpCode(200)
  cargo(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(CargoSchema)) body: z.infer<typeof CargoSchema>) {
    return this.svc.agregarCargo(u, id, body);
  }

  @RequierePermiso('estancia.checkout')
  @Auditar('estancia.cargo_anulado')
  @Delete('estancias/:id/cargos/:cargoId')
  anularCargo(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Param('cargoId', ParseIntPipe) cargoId: number) {
    return this.svc.anularCargo(u, id, cargoId);
  }

  @RequierePermiso('estancia.checkout')
  @Auditar('estancia.checkout')
  @Post('estancias/:id/checkout')
  @HttpCode(200)
  checkout(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(CheckoutSchema)) body: z.infer<typeof CheckoutSchema>) {
    return this.svc.checkout(u, id, body);
  }

  @Get('comprobantes')
  listar(@UsuarioActual() u: UsuarioSesion, @Query(new ZodValidationPipe(FechaSchema)) q: z.infer<typeof FechaSchema>) {
    return this.comprobantes.listar(u.sucursalId, q.fecha ?? hoyLima());
  }

  /** Lo que se enviará al proveedor en el S-08, armado y verificado (spec S-07 D10). */
  @Get('comprobantes/:id/estructura')
  estructura(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.comprobantes.estructura(u.sucursalId, id);
  }

  @Get('comprobantes/:id')
  comprobante(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.comprobantes.detalle(u.sucursalId, id);
  }
}
