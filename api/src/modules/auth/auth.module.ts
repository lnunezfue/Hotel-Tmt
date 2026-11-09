import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { leerConfigAuth } from '../../config';
import { SesionesService } from './application/sesiones.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { UsuarioSesionRepository } from './infrastructure/usuario-sesion.repository';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ ttl: 60_000, limit: leerConfigAuth().limitePorMin }],
        errorMessage: 'Demasiados intentos. Espera un minuto e inténtalo de nuevo',
      }),
    }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        const cfg = leerConfigAuth();
        return { secret: cfg.jwtSecret, signOptions: { expiresIn: cfg.accesoMin * 60 } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SesionesService, UsuarioSesionRepository, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [SesionesService],
})
export class AuthModule {}
