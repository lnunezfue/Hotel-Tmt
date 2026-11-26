import { Module } from '@nestjs/common';
import { HospedajeController } from './hospedaje.controller';
import { ConfiguracionController } from './configuracion.controller';
import { TableroEventosController } from './tablero-eventos.controller';
import { PlanoController } from './plano.controller';
import { PlanoService } from './application/plano.service';
import { HospedajeService } from './application/hospedaje.service';
import { ConfiguracionService } from './application/configuracion.service';
import { OperacionService } from './application/operacion.service';
import { AvisosTablero } from './application/avisos-tablero.service';
import { HabitacionRepository } from './infrastructure/habitacion.repository';
import { NotificadorTableroRedis } from './infrastructure/notificador-tablero.redis';
import { NOTIFICADOR_TABLERO } from './domain/notificador-tablero.port';

@Module({
  controllers: [HospedajeController, ConfiguracionController, TableroEventosController, PlanoController],
  providers: [
    HospedajeService,
    ConfiguracionService,
    OperacionService,
    PlanoService,
    HabitacionRepository,
    AvisosTablero,
    NotificadorTableroRedis,
    { provide: NOTIFICADOR_TABLERO, useExisting: NotificadorTableroRedis },
  ],
  exports: [AvisosTablero, ConfiguracionService, OperacionService],
})
export class HospedajeModule {}
