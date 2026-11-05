import {
  generarSecreto,
  hashSecreto,
  formatearToken,
  parsearToken,
  hashesIguales,
} from './token-renovacion';

describe('token-renovacion', () => {
  describe('parsearToken', () => {
    it('invierte formatearToken', () => {
      const s = generarSecreto();
      expect(parsearToken(formatearToken(42n, s))).toEqual({ sesionId: 42n, secreto: s });
    });

    it.each([undefined, '', 'abc', 'x.y', '1.', '.abc', '-1.abc', 'a'.repeat(5000)])(
      'rechaza %p',
      (valor) => {
        expect(parsearToken(valor)).toBeNull();
      },
    );

    it('rechaza ids por encima del máximo BIGINT con signo', () => {
      expect(parsearToken(`${'9'.repeat(19)}.abc`)).toBeNull();
      expect(parsearToken(`9223372036854775808.${generarSecreto()}`)).toBeNull();
    });

    it('acepta el máximo BIGINT con signo', () => {
      const s = generarSecreto();
      expect(parsearToken(`9223372036854775807.${s}`)).toEqual({ sesionId: 9223372036854775807n, secreto: s });
    });

    it('rechaza ids con ceros a la izquierda o más de 19 dígitos', () => {
      const s = generarSecreto();
      expect(parsearToken(`01.${s}`)).toBeNull();
      expect(parsearToken(`${'9'.repeat(20)}.${s}`)).toBeNull();
    });
  });

  describe('hashSecreto', () => {
    it('calcula SHA-256 en hex', () => {
      expect(hashSecreto('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
    });
  });

  describe('hashesIguales', () => {
    const h = hashSecreto('a');

    it('es true para hashes iguales', () => {
      expect(hashesIguales(h, h)).toBe(true);
    });

    it('es false para hashes distintos', () => {
      expect(hashesIguales(h, hashSecreto('b'))).toBe(false);
    });

    it('es false, sin lanzar, con longitudes distintas', () => {
      expect(hashesIguales(h, 'corto')).toBe(false);
      expect(hashesIguales('', h)).toBe(false);
    });
  });

  describe('generarSecreto', () => {
    it('devuelve 43 caracteres base64url y valores distintos', () => {
      const a = generarSecreto();
      const b = generarSecreto();
      expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(a).not.toBe(b);
    });
  });
});
