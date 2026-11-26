import { Module } from '@nestjs/common';
import { PROVEEDOR_FACTURACION } from './domain/proveedor-facturacion.port';
import { SimuladoAdapter } from './infrastructure/pse/simulado.adapter';
import { FacturacionController } from './facturacion.controller';
import { SeriesService } from './application/series.service';

/** El adaptador se elige por configuración (PSE_PROVEEDOR); cambiar de proveedor no toca la lógica de negocio. */
@Module({
  controllers: [FacturacionController],
  providers: [{ provide: PROVEEDOR_FACTURACION, useClass: SimuladoAdapter }, SeriesService],
  exports: [PROVEEDOR_FACTURACION, SeriesService],
})
export class FacturacionModule {}
