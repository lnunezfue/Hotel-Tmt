import { Module } from '@nestjs/common';
import { OrganizacionController } from './organizacion.controller';

@Module({ controllers: [OrganizacionController] })
export class OrganizacionModule {}
