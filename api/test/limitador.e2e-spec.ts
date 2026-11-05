import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { crearApp } from './utilidades';

describe('Limitador de intentos (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.LIMITE_AUTH_POR_MIN = '10';
    ({ app } = await crearApp());
  });

  afterAll(async () => {
    await app.close();
  });

  it('la petición 11 de login desde la misma IP responde 429; health no se limita', async () => {
    const username = `e2e_noexiste_${randomBytes(4).toString('hex')}`;
    const intento = () => request(app.getHttpServer()).post('/api/auth/login').send({ username, password: 'Clave-incorrecta-1' });

    for (let i = 1; i <= 10; i++) {
      const r = await intento();
      expect(r.status).toBe(401);
    }
    const bloqueado = await intento();
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body.message).toBe('Demasiados intentos. Espera un minuto e inténtalo de nuevo');

    const health = await request(app.getHttpServer()).get('/api/health');
    expect(health.status).toBe(200);
  });
});
