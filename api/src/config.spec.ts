import { leerConfigAuth } from './config';

describe('leerConfigAuth', () => {
  it('usa los valores por defecto en desarrollo', () => {
    expect(leerConfigAuth({})).toEqual({ jwtSecret: 'solo-desarrollo', accesoMin: 15, sesionMaxHoras: 12, graciaSeg: 30, limitePorMin: 10, trustProxy: false });
  });
  it('exige JWT_SECRET en producción (vacía cuenta como ausente)', () => {
    expect(() => leerConfigAuth({ NODE_ENV: 'production' })).toThrow('JWT_SECRET es obligatoria en producción');
    expect(() => leerConfigAuth({ NODE_ENV: 'production', JWT_SECRET: '' })).toThrow('JWT_SECRET es obligatoria en producción');
  });
  it('lee TRUST_PROXY como false o número de saltos', () => {
    expect(leerConfigAuth({ TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(leerConfigAuth({ TRUST_PROXY: '0' }).trustProxy).toBe(0);
    expect(leerConfigAuth({ TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(leerConfigAuth({ TRUST_PROXY: ' ' }).trustProxy).toBe(false);
  });
  it('rechaza TRUST_PROXY=true (confiaría en cualquier X-Forwarded-For) y valores no numéricos', () => {
    const mensaje = 'TRUST_PROXY debe ser false o un número de saltos (p. ej. 1)';
    expect(() => leerConfigAuth({ TRUST_PROXY: 'true' })).toThrow(mensaje);
    expect(() => leerConfigAuth({ TRUST_PROXY: 'TRUE' })).toThrow(mensaje);
    expect(() => leerConfigAuth({ TRUST_PROXY: 'abc' })).toThrow(mensaje);
    expect(() => leerConfigAuth({ TRUST_PROXY: '-1' })).toThrow(mensaje);
  });
  it('rechaza números inválidos', () => {
    expect(() => leerConfigAuth({ JWT_ACCESO_MIN: 'abc' })).toThrow('JWT_ACCESO_MIN debe ser un entero positivo');
    expect(() => leerConfigAuth({ SESION_MAX_HORAS: '0' })).toThrow('SESION_MAX_HORAS debe ser un entero positivo');
  });
});
