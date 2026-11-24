import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequierePermiso } from '../auth/permisos.decorator';
import { Auditar } from '../auditoria/auditar.decorator';
import { UsuarioActual, UsuarioSesion } from '../../common/usuario-actual.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ReservasService } from './application/reservas.service';
import { ClientesService } from './application/clientes.service';

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa AAAA-MM-DD');
const Id = z.number().int().positive();
const RangoSchema = z.object({ desde: Fecha, hasta: Fecha }).refine((r) => r.desde <= r.hasta, 'El rango está invertido');
const DisponibilidadSchema = z.object({ llegada: Fecha, cantidad: z.coerce.number().int().min(1).max(60), turnoId: z.coerce.number().int().positive(), hora: z.string().optional() });
const NuevaReservaSchema = z.object({
  clienteId: Id, canalId: Id, turnoId: Id, habitacionId: Id.optional(), llegada: Fecha,
  habitaciones: z.array(z.object({ habitacionId: Id, adultos: z.number().int().min(1).max(20), ninos: z.number().int().min(0).max(20).default(0) })).max(10).optional(),
  cantidad: z.number().int().min(1).max(60), hora: z.string().optional(),
  adultos: z.number().int().min(1).max(20).default(1), ninos: z.number().int().min(0).max(20).default(0),
  adelanto: z.number().min(0).max(999_999).optional(), metodoPagoId: Id.optional(), confirmar: z.boolean().optional(),
  codigoExterno: z.string().max(50).nullable().optional(), observaciones: z.string().max(500).nullable().optional(),
});
const CancelarSchema = z.object({ motivo: z.string().trim().min(3).max(250) });
const CheckinSchema = z.object({
  procedencia: z.string().max(100).nullable().optional(),
  placa: z.string().max(10).nullable().optional(),
  huespedes: z.array(z.object({ habitacionId: Id, titularId: Id.optional(), acompanantes: z.array(Id).max(10).default([]) })).max(10).optional(),
});
const BuscarSchema = z.object({ q: z.string().max(100).default('') });
const ClienteSchema = z.object({
  tipoDocumentoId: z.number().int().positive(), numeroDocumento: z.string().min(1).max(15),
  nombres: z.string().max(100).nullable().optional(), apellidos: z.string().max(100).nullable().optional(),
  razonSocial: z.string().max(200).nullable().optional(), pais: z.string().length(2).optional(),
  telefono: z.string().max(20).nullable().optional(), email: z.string().email().max(120).nullable().optional().or(z.literal('').transform(() => null)),
});

/** Reservas y huéspedes de la sucursal del token (spec S-06 §5). */
@ApiTags('reservas')
@Controller()
export class ReservasController {
  constructor(
    private readonly reservas: ReservasService,
    private readonly clientes: ClientesService,
  ) {}

  @RequierePermiso('reserva.ver')
  @Get('reservas')
  listar(@UsuarioActual() u: UsuarioSesion, @Query(new ZodValidationPipe(RangoSchema)) q: z.infer<typeof RangoSchema>) {
    return this.reservas.listar(u.sucursalId, q.desde, q.hasta);
  }

  @RequierePermiso('reserva.ver')
  @Get('reservas/disponibilidad')
  disponibilidad(@UsuarioActual() u: UsuarioSesion, @Query(new ZodValidationPipe(DisponibilidadSchema)) q: z.infer<typeof DisponibilidadSchema>) {
    return this.reservas.disponibilidad(u.sucursalId, q);
  }

  @RequierePermiso('reserva.ver')
  @Get('reservas/:id')
  detalle(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.reservas.detalle(u.sucursalId, id);
  }

  @RequierePermiso('reserva.crear')
  @Auditar('reserva.crear')
  @Post('reservas')
  crear(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(NuevaReservaSchema)) body: z.infer<typeof NuevaReservaSchema>) {
    return this.reservas.crear(u, body);
  }

  @RequierePermiso('reserva.crear')
  @Auditar('reserva.confirmar')
  @Post('reservas/:id/confirmar')
  @HttpCode(200)
  confirmar(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.reservas.cambiarEstado(u, id, 'confirmar');
  }

  @RequierePermiso('reserva.cancelar')
  @Auditar('reserva.cancelar')
  @Post('reservas/:id/cancelar')
  @HttpCode(200)
  cancelar(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(CancelarSchema)) body: z.infer<typeof CancelarSchema>) {
    return this.reservas.cambiarEstado(u, id, 'cancelar', body.motivo);
  }

  @RequierePermiso('reserva.cancelar')
  @Auditar('reserva.no_show')
  @Post('reservas/:id/no-show')
  @HttpCode(200)
  noShow(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.reservas.cambiarEstado(u, id, 'no_show');
  }

  @RequierePermiso('estancia.checkin')
  @Auditar('estancia.checkin')
  @Post('reservas/:id/checkin')
  @HttpCode(200)
  checkin(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(CheckinSchema)) body: z.infer<typeof CheckinSchema>) {
    return this.reservas.checkin(u, id, body);
  }

  @RequierePermiso('reserva.ver')
  @Get('clientes')
  buscarClientes(@UsuarioActual() u: UsuarioSesion, @Query(new ZodValidationPipe(BuscarSchema)) q: z.infer<typeof BuscarSchema>) {
    return this.clientes.buscar(u.empresaId, q.q);
  }

  @Get('clientes/tipos-documento')
  tiposDocumento() {
    return this.clientes.tiposDocumento();
  }

  @RequierePermiso('reserva.crear')
  @Auditar('cliente.crear')
  @Post('clientes')
  crearCliente(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(ClienteSchema)) body: z.infer<typeof ClienteSchema>) {
    return this.clientes.crear(u.empresaId, body);
  }
}
