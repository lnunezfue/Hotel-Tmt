import { Module } from '@nestjs/common';
import { HospedajeModule } from '../hospedaje/hospedaje.module';
import { ReservasController } from './reservas.controller';
import { ReservasService } from './application/reservas.service';
import { ClientesService } from './application/clientes.service';

@Module({ imports: [HospedajeModule], controllers: [ReservasController], providers: [ReservasService, ClientesService] })
export class ReservasModule {}
