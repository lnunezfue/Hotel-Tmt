import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

/**
 * Cliente Prisma con el motor de consultas en TypeScript (engineType = "client") y el adaptador
 * MariaDB, compatible con MySQL 8. No necesita binarios nativos de Prisma en el servidor.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const url = new URL(process.env.DATABASE_URL ?? '');
    super({
      adapter: new PrismaMariaDb({
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace('/', ''),
        connectionLimit: 10,
        allowPublicKeyRetrieval: true,
        // El adaptador escribe y lee las fechas como UTC (sin depender de la zona del proceso); fijar la zona de
        // la sesión a UTC hace que CURRENT_TIMESTAMP, NOW() y las columnas TIMESTAMP usen la misma referencia
        // aunque el servidor MySQL esté configurado con otra zona.
        initSql: "SET time_zone = '+00:00'",
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
