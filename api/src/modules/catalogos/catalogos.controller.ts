import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';

/** Catálogos SUNAT y generales cargados por la migración inicial (RNF-38: parametrizables). */
@ApiTags('catalogos')
@Controller('catalogos')
export class CatalogosController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('tipos-documento')
  tiposDocumento() {
    return this.prisma.tipo_documento_identidad.findMany({ where: { activo: true } });
  }

  @Get('tipos-comprobante')
  tiposComprobante() {
    return this.prisma.tipo_comprobante.findMany({ where: { activo: true } });
  }

  @Get('tipos-movimiento')
  tiposMovimiento() {
    return this.prisma.tipo_movimiento.findMany({ include: { concepto_movimiento: { where: { activo: true } } } });
  }

  @Get('metodos-pago')
  metodosPago() {
    return this.prisma.metodo_pago.findMany({ where: { activo: true } });
  }
}
