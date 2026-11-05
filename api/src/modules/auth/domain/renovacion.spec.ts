import { decidirRenovacion, EstadoSesion } from './renovacion';
import { hashSecreto } from './token-renovacion';

const min = (n: number) => n * 60_000;
const seg = (n: number) => n * 1_000;
const horas = (n: number) => n * 3_600_000;

const T0 = new Date('2026-11-05T14:00:00Z');
const H0 = hashSecreto('secreto-0');
const H1 = hashSecreto('secreto-1');
const HX = hashSecreto('secreto-x');

const base: EstadoSesion = {
  revocadaAt: null,
  motivoRevocacion: null,
  expiraAt: new Date(T0.getTime() + horas(12)),
  ultimaRenovacionAt: T0,
  refreshHash: H1,
  refreshHashAnterior: H0,
  rotadaAt: T0,
};
const cfg = { inactividadMin: 30, accesoMin: 15, graciaSeg: 30 };

describe('decidirRenovacion', () => {
  it.each([
    ['revocada', { ...base, revocadaAt: T0, motivoRevocacion: 'LOGOUT' as const }, H1, min(1), { tipo: 'RECHAZAR', motivo: 'LOGOUT' }],
    ['expirada', base, H1, horas(12) + seg(1), { tipo: 'REVOCAR', motivo: 'EXPIRADA' }],
    ['inactividad en el borde', base, H1, min(45), { tipo: 'ROTAR' }],
    ['inactividad superada', base, H1, min(45) + seg(1), { tipo: 'REVOCAR', motivo: 'INACTIVIDAD' }],
    ['token vigente', base, H1, min(10), { tipo: 'ROTAR' }],
    ['carrera dentro de 30 s', base, H0, seg(30), { tipo: 'CARRERA' }],
    ['anterior pasada la gracia', base, H0, seg(31), { tipo: 'REVOCAR', motivo: 'REUSO' }],
    ['anterior sin rotación', { ...base, rotadaAt: null }, H0, seg(1), { tipo: 'REVOCAR', motivo: 'REUSO' }],
    ['hash desconocido', base, HX, seg(1), { tipo: 'DESCONOCIDO' }],
    ['hash desconocido sin anterior', { ...base, refreshHashAnterior: null, rotadaAt: null }, H0, seg(1), { tipo: 'DESCONOCIDO' }],
    // La posesión se comprueba antes que los tiempos: sin un secreto conocido no se revoca ni se revela el motivo.
    ['hash desconocido en sesión expirada', base, HX, horas(12) + seg(1), { tipo: 'DESCONOCIDO' }],
    ['hash desconocido en sesión inactiva', base, HX, min(45) + seg(1), { tipo: 'DESCONOCIDO' }],
    ['hash desconocido en sesión revocada', { ...base, revocadaAt: T0, motivoRevocacion: 'ADMIN' as const }, HX, min(1), { tipo: 'DESCONOCIDO' }],
    ['anterior en sesión revocada', { ...base, revocadaAt: T0, motivoRevocacion: 'REUSO' as const }, H0, min(1), { tipo: 'RECHAZAR', motivo: 'REUSO' }],
    ['anterior en sesión expirada', base, H0, horas(12) + seg(1), { tipo: 'REVOCAR', motivo: 'EXPIRADA' }],
  ])('%s', (_n, s, hash, delta, esperado) => {
    expect(decidirRenovacion(s as EstadoSesion, hash, new Date(T0.getTime() + delta), cfg)).toEqual(esperado);
  });
});
