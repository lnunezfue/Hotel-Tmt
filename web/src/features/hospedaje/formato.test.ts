import { describe, expect, it } from 'vitest';
import { fechaCorta, soles } from './formato';

describe('formato', () => {
  it('soles con dos decimales', () => {
    expect(soles('70')).toBe('S/ 70.00');
    expect(soles(1250.5)).toBe('S/ 1,250.50');
  });
  it('fechaCorta no depende de la zona horaria', () => {
    expect(fechaCorta('2026-01-01')).toBe('01/01/2026');
  });
});
