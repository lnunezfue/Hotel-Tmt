import { describirError } from './describir-error';

describe('describirError', () => {
  it('usa el mensaje cuando lo hay', () => {
    expect(describirError(new Error('tiempo agotado'))).toBe('tiempo agotado');
  });

  it('usa el código cuando el mensaje viene vacío', () => {
    expect(describirError(Object.assign(new Error(''), { code: 'ECONNREFUSED' }))).toBe('ECONNREFUSED');
  });

  it('resume los errores internos de un AggregateError sin mensaje (Node al probar IPv4 e IPv6)', () => {
    const e = new AggregateError(
      [Object.assign(new Error('connect ECONNREFUSED ::1:6379'), { code: 'ECONNREFUSED' }), Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' })],
      '',
    );
    expect(describirError(e)).toBe('connect ECONNREFUSED ::1:6379; connect ECONNREFUSED 127.0.0.1:6379');
  });

  it('acepta valores que no son errores', () => {
    expect(describirError('texto')).toBe('texto');
    expect(describirError(undefined)).toBe('error desconocido');
  });
});
