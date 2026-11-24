import { describe, expect, it } from 'vitest';
import { diaLima, errorDocumento, instanteLima, sumarDias, totalReserva, ubicarBloque } from './reservas';

describe('documento del cliente', () => {
  it('acepta DNI de 8 dígitos y pasaportes en minúsculas', () => {
    expect(errorDocumento('1', '45678912')).toBeNull();
    expect(errorDocumento('7', 'cl8834521')).toBeNull();
  });

  it('explica qué falta', () => {
    expect(errorDocumento('1', '4567')).toBe('8 dígitos');
    expect(errorDocumento('1', '')).toBe('Escribe el número de documento');
  });

  it('revisa el dígito verificador del RUC', () => {
    expect(errorDocumento('6', '20100047218')).toBeNull();
    expect(errorDocumento('6', '20100047219')).toContain('dígito verificador');
  });
});

describe('fechas de Lima', () => {
  it('el día de Lima no depende de la zona del navegador', () => {
    expect(diaLima(new Date('2026-11-25T03:00:00Z'))).toBe('2026-11-24');
    expect(diaLima(new Date('2026-11-25T05:00:00Z'))).toBe('2026-11-25');
  });

  it('arma la hora con zona y suma días', () => {
    expect(new Date(instanteLima('2026-11-25', '14:00')).toISOString()).toBe('2026-11-25T19:00:00.000Z');
    expect(sumarDias('2026-12-30', 3)).toBe('2027-01-02');
  });
});

describe('calendario', () => {
  const desde = '2026-11-24';
  it('ubica un bloque por fracciones de día', () => {
    const b = ubicarBloque(new Date(instanteLima('2026-11-25', '12:00')), new Date(instanteLima('2026-11-27', '12:00')), desde, 14);
    expect(b).toEqual({ desde: 1.5, hasta: 3.5 });
  });

  it('recorta lo que sale de la grilla y descarta lo que queda fuera', () => {
    expect(ubicarBloque(new Date(instanteLima('2026-11-20', '12:00')), new Date(instanteLima('2026-11-25', '00:00')), desde, 14)).toEqual({ desde: 0, hasta: 1 });
    expect(ubicarBloque(new Date(instanteLima('2026-11-20', '12:00')), new Date(instanteLima('2026-11-23', '00:00')), desde, 14)).toBeNull();
  });

  it('suma la reserva sin errores de coma flotante', () => {
    expect(totalReserva(['70.10', '110.20'], 3)).toBe(540.9);
    expect(totalReserva(['70.00', null], 1)).toBeNull();
  });
});
