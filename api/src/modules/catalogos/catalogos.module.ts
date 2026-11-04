import { Module } from '@nestjs/common';
import { CatalogosController } from './catalogos.controller';

@Module({ controllers: [CatalogosController] })
export class CatalogosModule {}
