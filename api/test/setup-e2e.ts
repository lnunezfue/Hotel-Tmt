import 'dotenv/config';

// La zona America/Lima se fija en test/zona-horaria.global-setup.ts: aquí process.env está aislado
// y cambiar TZ no afectaría al proceso.
process.env.NODE_ENV = 'test';
// Sin ??=: api/.env define LIMITE_AUTH_POR_MIN=10 y dotenv ya lo cargó arriba.
process.env.LIMITE_AUTH_POR_MIN = '1000';
