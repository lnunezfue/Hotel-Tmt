import { describe, expect, it } from 'vitest';
import type { Operacion } from '../../lib/api';
import { horaConDia, salidaPrevista } from './operacion';

const lima = (s: string) => new Date(`${s}:00-05:00`);
const OP: Operacion = {
  configurada: true, cobroAlIngreso: true, vendeConsumos: false, minutosLimpieza: 30, horaSalidaNoche: '09:00', turnoSugeridoId: null,
  franjas: [
    { nombre: 'Madrugada', desde: '00:00', hasta: '06:00', salidaMaxima: '12:00', diasDespues: 0 },
    { nombre: 'Mañana', desde: '06:00', hasta: '12:00', salidaMaxima: '18:00', diasDespues: 0 },
    { nombre: 'Tarde y noche', desde: '12:00', hasta: '00:00', salidaMaxima: '06:00', diasDespues: 1 },
  ],
};

describe('vista previa de la salida', () => {
  it('por horas: suma las horas y conoce la hora máxima de la franja', () => {
    const p = salidaPrevista(lima('2026-11-26T21:15'), 4, 1, OP);
    expect(p).toMatchObject({ salida: lima('2026-11-27T01:15'), maxima: lima('2026-11-27T06:00'), franja: 'Tarde y noche', excede: false, caben: 2 });
    expect(salidaPrevista(lima('2026-11-26T23:00'), 4, 2, OP).excede).toBe(true);
  });

  it('la noche sale a las 9:00; de madrugada, el mismo día', () => {
    expect(salidaPrevista(lima('2026-11-26T20:00'), 24, 1, OP).salida).toEqual(lima('2026-11-27T09:00'));
    expect(salidaPrevista(lima('2026-11-26T02:00'), 24, 1, OP).salida).toEqual(lima('2026-11-26T09:00'));
  });

  it('sin operación configurada no hay tope', () => {
    expect(salidaPrevista(lima('2026-11-26T23:00'), 12, 2, undefined)).toMatchObject({ excede: false, maxima: null });
  });

  it('dice si la salida es mañana', () => {
    expect(horaConDia(lima('2026-11-27T06:00'), lima('2026-11-26T21:00'))).toBe('06:00 de mañana');
    expect(horaConDia(lima('2026-11-26T23:30'), lima('2026-11-26T21:00'))).toBe('23:30');
  });
});
