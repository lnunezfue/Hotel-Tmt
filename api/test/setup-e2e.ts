import 'dotenv/config';

// La zona America/Lima se fija en test/zona-horaria.global-setup.ts: aquí process.env está aislado
// y cambiar TZ no afectaría al proceso.
process.env.NODE_ENV = 'test';
process.env.LIMITE_AUTH_POR_MIN ??= '1000';
