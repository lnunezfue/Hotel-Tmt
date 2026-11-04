import { Module } from '@nestjs/common';
import { HospedajeController } from './hospedaje.controller';
import { HospedajeService } from './application/hospedaje.service';
import { HabitacionRepository } from './infrastructure/habitacion.repository';

@Module({ controllers: [HospedajeController], providers: [HospedajeService, HabitacionRepository] })
export class HospedajeModule {}
