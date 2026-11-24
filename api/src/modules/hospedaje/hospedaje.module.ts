import { Module } from '@nestjs/common';
import { HospedajeController } from './hospedaje.controller';
import { ConfiguracionController } from './configuracion.controller';
import { TableroEventosController } from './tablero-eventos.controller';
import { ReservasController } from './reservas.controller';
import { HospedajeService } from './application/hospedaje.service';
import { ConfiguracionService } from './application/configuracion.service';
import { AvisosTablero } from './application/avisos-tablero.service';
import { ClientesService } from './application/clientes.service';
import { ReservasService } from './application/reservas.service';
import { EstanciasService } from './application/estancias.service';
import { HabitacionRepository } from './infrastructure/habitacion.repository';
import { NotificadorTableroRedis } from './infrastructure/notificador-tablero.redis';
import { NOTIFICADOR_TABLERO } from './domain/notificador-tablero.port';

@Module({
  controllers: [HospedajeController, ConfiguracionController, TableroEventosController, ReservasController],
  providers: [
    HospedajeService,
    ConfiguracionService,
    HabitacionRepository,
    AvisosTablero,
    ClientesService,
    ReservasService,
    EstanciasService,
    NotificadorTableroRedis,
    { provide: NOTIFICADOR_TABLERO, useExisting: NotificadorTableroRedis },
  ],
})
export class HospedajeModule {}
