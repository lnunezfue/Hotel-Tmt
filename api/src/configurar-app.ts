import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { leerConfigAuth } from './config';

// Prisma devuelve BIGINT como bigint; JSON no lo soporta.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

/** Configuración común de la app (la usan main.ts y las pruebas e2e). */
export function configurarApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.set('trust proxy', leerConfigAuth().trustProxy);
}
