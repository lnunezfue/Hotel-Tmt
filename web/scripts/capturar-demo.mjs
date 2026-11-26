#!/usr/bin/env node
/**
 * Captura la foto de datos de la demo web (src/demo/datos.json) desde la API real con el seed recién cargado.
 * Uso: con la API en marcha (pnpm --filter api start) y la base recién sembrada,
 *   node web/scripts/capturar-demo.mjs [http://localhost:3000/api]
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? 'http://localhost:3000/api';
const CLAVE = 'Hotel2026!';
const SALIDA = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'demo', 'datos.json');

const RUTAS = [
  '/organizacion/empresa', '/organizacion/sucursales', '/organizacion/sucursales/todas', '/organizacion/usuarios', '/organizacion/roles',
  '/organizacion/permisos', '/hospedaje/tablero', '/hospedaje/plano', '/hospedaje/amenidades', '/hospedaje/canales', '/hospedaje/config/canales',
  '/hospedaje/turnos', '/hospedaje/config/turnos', '/hospedaje/tarifas', '/hospedaje/config/tipos-habitacion', '/hospedaje/estados', '/hospedaje/operacion',
  '/clientes/tipos-documento', '/productos', '/caja/metodos-pago', '/caja', '/clientes', '/facturacion/series',
];

async function sesion(usuario) {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: usuario, password: CLAVE }) });
  if (!r.ok) throw new Error(`login ${usuario}: ${r.status} ${await r.text()}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return async (ruta) => {
    const res = await fetch(`${BASE}${ruta}`, { headers: { cookie } });
    if (!res.ok) throw new Error(`${ruta}: ${res.status} ${await res.text()}`);
    return res.json();
  };
}

const admin = await sesion('admin');
const recepcion = await sesion('recepcion1');
const rutas = {};
for (const ruta of RUTAS) {
  try {
    rutas[ruta] = await admin(ruta);
  } catch (e) {
    console.warn(`(se omite) ${e.message}`);
  }
}
// El calendario de reservas de la semana (la demo arranca en hoy)
const hoy = new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
const enDias = (n) => new Date(Date.parse(`${hoy}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
rutas['/reservas'] = await admin(`/reservas?desde=${enDias(-1)}&hasta=${enDias(14)}`);

const ocupadas = rutas['/hospedaje/tablero'].pisos.flatMap((p) => p.habitaciones).filter((h) => h.estancia);
const estancias = [];
for (const h of ocupadas) estancias.push(await admin(`/estancias/habitacion/${h.id}`));
const cartera = await admin('/clientes/cartera');
const clientes = cartera.map(({ id, documento, nombre, telefono, pais }) => ({ id, documento, nombre, telefono: telefono ?? null, pais }));

const foto = { capturado: new Date().toISOString(), hoy, me: { admin: await admin('/auth/me'), recepcion1: await recepcion('/auth/me') }, rutas, clientes, estancias };
writeFileSync(SALIDA, `${JSON.stringify(foto, null, 1)}\n`);
console.log(`Foto guardada en ${SALIDA}: ${estancias.length} estadías, ${clientes.length} clientes, ${rutas['/reservas'].length} reservas.`);
