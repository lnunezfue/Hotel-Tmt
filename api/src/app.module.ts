import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuditoriaModule } from './modules/auditoria/auditoria.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizacionModule } from './modules/organizacion/organizacion.module';
import { CatalogosModule } from './modules/catalogos/catalogos.module';
import { HospedajeModule } from './modules/hospedaje/hospedaje.module';
import { FacturacionModule } from './modules/facturacion/facturacion.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditoriaModule,
    AuthModule,
    OrganizacionModule,
    CatalogosModule,
    HospedajeModule,
    FacturacionModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
