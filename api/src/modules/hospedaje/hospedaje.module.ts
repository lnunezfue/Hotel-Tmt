import { Module } from '@nestjs/common';
import { HospedajeController } from './hospedaje.controller';
import { ConfiguracionController } from './configuracion.controller';
import { HospedajeService } from './application/hospedaje.service';
import { ConfiguracionService } from './application/configuracion.service';
import { HabitacionRepository } from './infrastructure/habitacion.repository';

@Module({ controllers: [HospedajeController, ConfiguracionController], providers: [HospedajeService, ConfiguracionService, HabitacionRepository] })
export class HospedajeModule {}
