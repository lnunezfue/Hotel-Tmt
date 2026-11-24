import { Module } from '@nestjs/common';
import { HospedajeModule } from '../hospedaje/hospedaje.module';
import { CajaModule } from '../caja/caja.module';
import { ReservasController } from './reservas.controller';
import { ReservasService } from './application/reservas.service';
import { ClientesService } from './application/clientes.service';

@Module({ imports: [HospedajeModule, CajaModule], controllers: [ReservasController], providers: [ReservasService, ClientesService] })
export class ReservasModule {}
