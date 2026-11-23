import { describe, expect, it } from 'vitest';
import { diasEntre, hoyLima, posicionEnDias, sumarDias } from './fechas';

describe('fechas de reservas', () => {
  it('hoy en Lima', () => {
    expect(hoyLima(new Date('2026-11-24T03:00:00Z'))).toBe('2026-11-23');
  });
  it('suma y resta días', () => {
    expect(sumarDias('2026-11-30', 2)).toBe('2026-12-02');
    expect(diasEntre('2026-11-23', '2026-12-01')).toBe(8);
  });
  it('una entrada a las 14:00 cae a 14/24 del día', () => {
    expect(posicionEnDias('2026-11-23T19:00:00Z', '2026-11-23')).toBeCloseTo(14 / 24);
    expect(posicionEnDias('2026-11-25T17:00:00Z', '2026-11-23')).toBeCloseTo(2.5);
  });
});
