import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Punto de entrada del trabajador (DT-001 §4.1): mismo código que la API, sin servidor HTTP.
 * Aquí se registrará el consumidor de la cola de emisión a SUNAT (BullMQ) en la fase de facturación.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  console.log('Trabajador iniciado. Cola de emisión: pendiente de implementar (fase de facturación).');
  const cerrar = async () => { await app.close(); process.exit(0); };
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
}
void bootstrap();
