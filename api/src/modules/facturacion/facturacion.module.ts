import { Module } from '@nestjs/common';
import { PROVEEDOR_FACTURACION } from './domain/proveedor-facturacion.port';
import { SimuladoAdapter } from './infrastructure/pse/simulado.adapter';

/** El adaptador se elige por configuración (PSE_PROVEEDOR); cambiar de proveedor no toca la lógica de negocio. */
@Module({
  providers: [{ provide: PROVEEDOR_FACTURACION, useClass: SimuladoAdapter }],
  exports: [PROVEEDOR_FACTURACION],
})
export class FacturacionModule {}
