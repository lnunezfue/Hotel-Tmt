import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequierePermiso } from '../auth/permisos.decorator';
import { Auditar } from '../auditoria/auditar.decorator';
import { UsuarioActual, UsuarioSesion } from '../../common/usuario-actual.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ClientesService } from './application/clientes.service';
import { ContextoSucursal } from './application/configuracion.service';
import { EstanciasService } from './application/estancias.service';
import { ReservasService } from './application/reservas.service';

const Id = z.coerce.number().int().positive();
const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa AAAA-MM-DD');
const Instante = z.string().datetime({ offset: true, message: 'Usa una fecha y hora ISO, p. ej. 2026-11-25T14:00:00-05:00' });
const Opcional = (max: number) => z.string().max(max).nullable().optional();
const conCambios = <T extends z.ZodRawShape>(s: z.ZodObject<T>) => s.partial().refine((o) => Object.keys(o).length > 0, 'No hay cambios');

// Formatos y largos los valida el dominio (cliente.ts, reserva.ts, estancia.ts); aquí solo la forma.
const ClienteBase = z.object({
  tipoDocumento: z.string().max(1),
  numeroDocumento: z.string().max(30),
  razonSocial: Opcional(300),
  nombres: Opcional(200),
  apellidos: Opcional(200),
  paisCodigo: z.string().length(2).optional(),
  direccion: Opcional(300),
  fechaNacimiento: Fecha.nullable().optional(),
  sexo: z.enum(['M', 'F', 'X']).nullable().optional(),
  telefono: Opcional(40),
  email: Opcional(200),
  observaciones: Opcional(600),
});
const EditarClienteSchema = conCambios(ClienteBase.extend({ activo: z.boolean() }));
const BuscarClientesQuery = z.object({ q: z.string().max(100).optional(), incluirInactivos: z.enum(['true', 'false']).optional() });

const ReservaSchema = z.object({
  clienteId: z.number().int().positive(),
  canalId: z.number().int().positive(),
  entrada: Instante,
  turnoId: z.number().int().positive(),
  cantidadTurnos: z.number(),
  adultos: z.number(),
  ninos: z.number().default(0),
  habitacionIds: z.array(z.number().int().positive()).min(1, 'Elige al menos una habitación').max(20),
  codigoExterno: Opcional(100),
  observaciones: Opcional(600),
});
const MotivoSchema = z.object({ motivo: z.string().max(400) });
const CalendarioQuery = z.object({ desde: Fecha.optional(), dias: z.coerce.number().int().min(1).max(31).default(14) });
const DisponiblesQuery = z.object({ entrada: Instante, turnoId: Id, cantidad: z.coerce.number().int(), canalId: Id });

const Libro = { procedencia: z.string().max(200), destino: Opcional(200), motivoViaje: z.string().max(40), placaVehiculo: Opcional(20) };
const Huespedes = { titularId: z.number().int().positive(), acompanantes: z.array(z.number().int().positive()).max(19).default([]) };
const CheckinSchema = z.union([
  z.object({ reservaHabitacionId: z.number().int().positive(), ...Huespedes, ...Libro }).strict(),
  z
    .object({ habitacionId: z.number().int().positive(), canalId: z.number().int().positive(), turnoId: z.number().int().positive(), cantidadTurnos: z.number(), ...Huespedes, ...Libro })
    .strict(),
]);
const ExtensionSchema = z.object({ turnos: z.number() });
const LibroQuery = z.object({ desde: Fecha, hasta: Fecha });

const ctx = (u: UsuarioSesion): ContextoSucursal => ({ empresaId: u.empresaId, sucursalId: u.sucursalId });

/** Clientes, reservas y estancias de la sucursal del token (spec S-06). */
@ApiTags('hospedaje · reservas y estancias')
@Controller('hospedaje')
export class ReservasController {
  constructor(
    private readonly clientes: ClientesService,
    private readonly reservas: ReservasService,
    private readonly estancias: EstanciasService,
  ) {}

  // ── Clientes (RF-RES-17) ────────────────────────────────────────

  @RequierePermiso('cliente.gestionar', 'reserva.crear', 'estancia.checkin')
  @Get('clientes')
  buscarClientes(@UsuarioActual() u: UsuarioSesion, @Query(new ZodValidationPipe(BuscarClientesQuery)) q: z.infer<typeof BuscarClientesQuery>) {
    return this.clientes.buscar(u.empresaId, q.q, q.incluirInactivos === 'true');
  }

  @RequierePermiso('cliente.gestionar', 'reserva.crear', 'estancia.checkin')
  @Get('clientes/:id')
  cliente(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.clientes.obtener(u.empresaId, id);
  }

  @RequierePermiso('cliente.gestionar', 'reserva.crear', 'estancia.checkin')
  @Auditar('cliente.crear')
  @Post('clientes')
  crearCliente(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(ClienteBase)) body: z.infer<typeof ClienteBase>) {
    return this.clientes.crear(u.empresaId, body);
  }

  @RequierePermiso('cliente.gestionar', 'reserva.crear', 'estancia.checkin')
  @Auditar('cliente.editar')
  @Patch('clientes/:id')
  editarCliente(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(EditarClienteSchema)) body: z.infer<typeof EditarClienteSchema>) {
    return this.clientes.editar(u.empresaId, id, body);
  }

  // ── Reservas (RF-RES-06, RF-RES-16) ─────────────────────────────

  @RequierePermiso('reserva.crear', 'estancia.checkin')
  @Get('reservas/calendario')
  calendario(@UsuarioActual() u: UsuarioSesion, @Query(new ZodValidationPipe(CalendarioQuery)) q: z.infer<typeof CalendarioQuery>) {
    return this.reservas.calendario(ctx(u), q.desde, q.dias);
  }

  @RequierePermiso('reserva.crear', 'estancia.checkin')
  @Get('reservas/disponibles')
  disponibles(@UsuarioActual() u: UsuarioSesion, @Query(new ZodValidationPipe(DisponiblesQuery)) q: z.infer<typeof DisponiblesQuery>) {
    return this.reservas.disponibles(ctx(u), q);
  }

  @RequierePermiso('reserva.crear', 'estancia.checkin')
  @Get('reservas/:id')
  reserva(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.reservas.obtener(ctx(u), id);
  }

  @RequierePermiso('reserva.crear')
  @Auditar('reserva.crear')
  @Post('reservas')
  crearReserva(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(ReservaSchema)) body: z.infer<typeof ReservaSchema>) {
    return this.reservas.crear(ctx(u), u.sub, body);
  }

  @RequierePermiso('reserva.crear')
  @Auditar('reserva.confirmar')
  @HttpCode(200)
  @Post('reservas/:id/confirmar')
  confirmar(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.reservas.confirmar(ctx(u), id);
  }

  @RequierePermiso('reserva.cancelar')
  @Auditar('reserva.anular')
  @HttpCode(200)
  @Post('reservas/:id/anular')
  anular(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(MotivoSchema)) body: z.infer<typeof MotivoSchema>) {
    return this.reservas.anular(ctx(u), u.sub, id, body.motivo);
  }

  @RequierePermiso('reserva.cancelar')
  @Auditar('reserva.no_show')
  @HttpCode(200)
  @Post('reservas/:id/no-show')
  noShow(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(MotivoSchema)) body: z.infer<typeof MotivoSchema>) {
    return this.reservas.noShow(ctx(u), u.sub, id, body.motivo);
  }

  // ── Estancias (RF-RES-10 a 13) ──────────────────────────────────

  @RequierePermiso('estancia.checkin')
  @Auditar('estancia.checkin')
  @Post('estancias')
  checkin(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(CheckinSchema)) body: z.infer<typeof CheckinSchema>) {
    return this.estancias.checkin(ctx(u), u.sub, body);
  }

  @RequierePermiso('estancia.checkin', 'estancia.checkout')
  @Get('estancias/:id')
  estancia(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.estancias.obtener(ctx(u), id);
  }

  @RequierePermiso('estancia.checkin')
  @Auditar('estancia.extender')
  @HttpCode(200)
  @Post('estancias/:id/extension')
  extender(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(ExtensionSchema)) body: z.infer<typeof ExtensionSchema>) {
    return this.estancias.extender(ctx(u), id, body.turnos);
  }

  @RequierePermiso('estancia.checkout')
  @Get('estancias/:id/liquidacion')
  liquidacion(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.estancias.liquidacion(ctx(u), id);
  }

  @RequierePermiso('estancia.checkout')
  @Auditar('estancia.checkout')
  @HttpCode(200)
  @Post('estancias/:id/checkout')
  checkout(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.estancias.checkout(ctx(u), u.sub, id);
  }

  // ── Libro de huéspedes (RF-RES-11) ──────────────────────────────

  @RequierePermiso('estancia.checkin', 'reporte.ver')
  @Get('libro-huespedes')
  libro(@UsuarioActual() u: UsuarioSesion, @Query(new ZodValidationPipe(LibroQuery)) q: z.infer<typeof LibroQuery>) {
    return this.estancias.libro(ctx(u), q.desde, q.hasta);
  }
}
