import { leerConfigAuth } from './config';

describe('leerConfigAuth', () => {
  it('usa los valores por defecto en desarrollo', () => {
    expect(leerConfigAuth({})).toEqual({ jwtSecret: 'solo-desarrollo', accesoMin: 15, sesionMaxHoras: 12, graciaSeg: 30, limitePorMin: 10, trustProxy: false });
  });
  it('exige JWT_SECRET en producción (vacía cuenta como ausente)', () => {
    expect(() => leerConfigAuth({ NODE_ENV: 'production' })).toThrow('JWT_SECRET es obligatoria en producción');
    expect(() => leerConfigAuth({ NODE_ENV: 'production', JWT_SECRET: '' })).toThrow('JWT_SECRET es obligatoria en producción');
  });
  it('lee TRUST_PROXY numérico y booleano', () => {
    expect(leerConfigAuth({ TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(leerConfigAuth({ TRUST_PROXY: 'true' }).trustProxy).toBe(true);
  });
  it('rechaza números inválidos', () => {
    expect(() => leerConfigAuth({ JWT_ACCESO_MIN: 'abc' })).toThrow('JWT_ACCESO_MIN debe ser un entero positivo');
    expect(() => leerConfigAuth({ SESION_MAX_HORAS: '0' })).toThrow('SESION_MAX_HORAS debe ser un entero positivo');
  });
});
