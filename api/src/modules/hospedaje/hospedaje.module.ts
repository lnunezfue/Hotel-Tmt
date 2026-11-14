import { Module } from '@nestjs/common';
import { HospedajeController } from './hospedaje.controller';
import { ConfiguracionController } from './configuracion.controller';
import { TableroEventosController } from './tablero-eventos.controller';
import { HospedajeService } from './application/hospedaje.service';
import { ConfiguracionService } from './application/configuracion.service';
import { AvisosTablero } from './application/avisos-tablero.service';
import { HabitacionRepository } from './infrastructure/habitacion.repository';
import { NotificadorTableroRedis } from './infrastructure/notificador-tablero.redis';
import { NOTIFICADOR_TABLERO } from './domain/notificador-tablero.port';

@Module({
  controllers: [HospedajeController, ConfiguracionController, TableroEventosController],
  providers: [
    HospedajeService,
    ConfiguracionService,
    HabitacionRepository,
    AvisosTablero,
    NotificadorTableroRedis,
    { provide: NOTIFICADOR_TABLERO, useExisting: NotificadorTableroRedis },
  ],
})
export class HospedajeModule {}
