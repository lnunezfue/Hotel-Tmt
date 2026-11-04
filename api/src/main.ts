import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

// Prisma devuelve BIGINT como bigint; JSON no lo soporta.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  const doc = new DocumentBuilder().setTitle('Hotel SUNAT API').setDescription('DT-001 · Sistema de Gestión Hotelera').setVersion('0.1.0').build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API lista en http://localhost:${port}/api · documentación en /api/docs`);
}
void bootstrap();
