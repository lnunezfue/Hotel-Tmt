import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequierePermiso } from '../auth/permisos.decorator';
import { Auditar } from '../auditoria/auditar.decorator';
import { UsuarioActual, UsuarioSesion } from '../../common/usuario-actual.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { SeriesService } from './application/series.service';
import { TIPOS_SERIE } from './domain/serie';

// Formato y rango los valida el dominio (serie.ts); aquí solo la forma.
const SerieSchema = z.object({ tipo: z.enum(TIPOS_SERIE), serie: z.string().max(10), correlativoInicial: z.number().optional() });
const EditarSerieSchema = z.object({ activo: z.boolean() });
const AsignarSchema = z.object({ usuarioIds: z.array(z.number().int().positive()).max(100) });
const ParaEmitirSchema = z.object({ tipo: z.enum(TIPOS_SERIE), serieId: z.coerce.number().int().positive().optional() });

/** Series de comprobantes de la sucursal del token (spec S-07). */
@ApiTags('facturación · series')
@Controller('facturacion')
export class FacturacionController {
  constructor(private readonly series: SeriesService) {}

  @RequierePermiso('config.empresa')
  @Get('series')
  listar(@UsuarioActual() u: UsuarioSesion) {
    return this.series.listar(u.sucursalId);
  }

  @RequierePermiso('config.empresa')
  @Get('series/usuarios')
  usuarios(@UsuarioActual() u: UsuarioSesion) {
    return this.series.usuariosAsignables(u.empresaId, u.sucursalId);
  }

  /** La serie con la que el usuario emitiría ahora (se muestra en el check-out antes de cobrar). */
  @RequierePermiso('estancia.checkout', 'comprobante.emitir')
  @Get('series/para-emitir')
  paraEmitir(@UsuarioActual() u: UsuarioSesion, @Query(new ZodValidationPipe(ParaEmitirSchema)) q: z.infer<typeof ParaEmitirSchema>) {
    return this.series.paraEmitir(u.sucursalId, u.sub, q.tipo, q.serieId);
  }

  @RequierePermiso('config.empresa')
  @Auditar('serie.crear')
  @Post('series')
  crear(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(SerieSchema)) body: z.infer<typeof SerieSchema>) {
    return this.series.crear(u.sucursalId, body);
  }

  @RequierePermiso('config.empresa')
  @Auditar('serie.editar')
  @Patch('series/:id')
  editar(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(EditarSerieSchema)) body: z.infer<typeof EditarSerieSchema>) {
    return this.series.editar(u.sucursalId, id, body.activo);
  }

  @RequierePermiso('config.empresa')
  @Auditar('serie.asignar')
  @Put('series/:id/usuarios')
  asignar(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(AsignarSchema)) body: z.infer<typeof AsignarSchema>) {
    return this.series.asignar(u.empresaId, u.sucursalId, id, body.usuarioIds);
  }
}
