// Espera a que MySQL acepte conexiones (lo usa `pnpm setup` después de docker compose up).
const net = require('net');
const url = new URL(process.env.DATABASE_URL || 'mysql://localhost:3306');
const deadline = Date.now() + 60000;
(function intentar() {
  const s = net.connect(Number(url.port || 3306), url.hostname, () => { s.end(); console.log('MySQL listo'); process.exit(0); });
  s.on('error', () => { if (Date.now() > deadline) { console.error('MySQL no respondió en 60 s'); process.exit(1); } setTimeout(intentar, 1500); });
})();
