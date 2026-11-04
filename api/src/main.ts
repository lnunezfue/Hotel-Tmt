import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { leerConfigAuth } from './config';
import { configurarApp } from './configurar-app';

async function bootstrap() {
  leerConfigAuth(); // falla pronto si falta configuración obligatoria
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configurarApp(app);
  const doc = new DocumentBuilder().setTitle('Hotel SUNAT API').setDescription('DT-001 · Sistema de Gestión Hotelera').setVersion('0.1.0').build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`API lista en http://localhost:${port}/api · documentación en /api/docs`);
}
void bootstrap();
