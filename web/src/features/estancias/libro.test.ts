import { describe, expect, it } from 'vitest';
import { esEmpresa, turnosPorSalidaTardia } from './libro';

describe('estadía', () => {
  it('reconoce a una empresa por su RUC 20', () => {
    expect(esEmpresa('RUC 20100047218')).toBe(true);
    expect(esEmpresa('RUC 10456789012')).toBe(false);
    expect(esEmpresa('DNI 45678912')).toBe(false);
  });

  it('suma turnos solo pasada la tolerancia', () => {
    const salida = '2026-11-25T17:00:00.000Z';
    expect(turnosPorSalidaTardia(salida, new Date('2026-11-25T17:30:00.000Z'), 24)).toBe(0);
    expect(turnosPorSalidaTardia(salida, new Date('2026-11-25T17:31:00.000Z'), 24)).toBe(1);
    expect(turnosPorSalidaTardia(salida, new Date('2026-11-25T23:10:00.000Z'), 3)).toBe(3);
  });
});
