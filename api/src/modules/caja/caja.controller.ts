import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequierePermiso } from '../auth/permisos.decorator';
import { Auditar } from '../auditoria/auditar.decorator';
import { UsuarioActual, UsuarioSesion } from '../../common/usuario-actual.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CajaService, CONCEPTOS_MANUALES } from './application/caja.service';

const AbrirSchema = z.object({ cajaId: z.number().int().positive().optional(), monto: z.number().min(0).max(100_000) });
const CerrarSchema = z.object({ montoDeclarado: z.number().min(0).max(1_000_000) });
const MovimientoSchema = z.object({ concepto: z.enum(CONCEPTOS_MANUALES), monto: z.number().positive().max(100_000), descripcion: z.string().trim().min(3).max(250) });

/** Caja de recepción de la sucursal del token (spec S-07 §5). */
@ApiTags('caja')
@Controller('caja')
export class CajaController {
  constructor(private readonly caja: CajaService) {}

  @Get()
  actual(@UsuarioActual() u: UsuarioSesion) {
    return this.caja.actual(u);
  }

  @Get('metodos-pago')
  metodos() {
    return this.caja.metodos();
  }

  @RequierePermiso('caja.abrir')
  @Auditar('caja.abrir')
  @Post('abrir')
  @HttpCode(200)
  abrir(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(AbrirSchema)) body: z.infer<typeof AbrirSchema>) {
    return this.caja.abrir(u, body);
  }

  @RequierePermiso('caja.abrir')
  @Auditar('caja.movimiento')
  @Post('movimientos')
  @HttpCode(200)
  movimiento(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(MovimientoSchema)) body: z.infer<typeof MovimientoSchema>) {
    return this.caja.movimientoManual(u, body);
  }

  @RequierePermiso('caja.cerrar')
  @Auditar('caja.cerrar')
  @Post('cerrar')
  @HttpCode(200)
  cerrar(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(CerrarSchema)) body: z.infer<typeof CerrarSchema>) {
    return this.caja.cerrar(u, body.montoDeclarado);
  }
}
