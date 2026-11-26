import { Module } from '@nestjs/common';
import { CajaModule } from '../caja/caja.module';
import { HospedajeModule } from '../hospedaje/hospedaje.module';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { EstanciasController } from './estancias.controller';
import { EstanciasService } from './application/estancias.service';
import { ComprobantesService } from './application/comprobantes.service';

@Module({ imports: [HospedajeModule, CajaModule, FacturacionModule], controllers: [EstanciasController], providers: [EstanciasService, ComprobantesService] })
export class EstanciasModule {}
