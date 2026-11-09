import { describe, expect, it } from 'vitest';
import { generarClaveTemporal, problemasClave } from './clave';

describe('problemasClave', () => {
  it('acepta una clave válida', () => {
    expect(problemasClave('Hotel2026!', 'admin')).toEqual([]);
  });
  it('lista lo que falta', () => {
    expect(problemasClave('abc')).toEqual(['al menos 8 caracteres', 'un número']);
    expect(problemasClave('caja1-segura', 'caja1')).toEqual(['no contener el usuario']);
  });
});

describe('generarClaveTemporal', () => {
  it('cumple la política y no usa caracteres confundibles', () => {
    for (let i = 0; i < 50; i++) {
      const c = generarClaveTemporal();
      expect(problemasClave(c)).toEqual([]);
      expect(c).not.toMatch(/[0O1lI]/);
    }
  });
});
