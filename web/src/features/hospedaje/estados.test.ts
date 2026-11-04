import { describe, expect, it } from 'vitest';
import { accionHacia, ESTADOS, ESTILO_ESTADO, tiempoRestante } from './estados';

describe('estados de habitación en la interfaz', () => {
  it('cada estado tiene estilo y acción', () => {
    for (const e of ESTADOS) {
      expect(ESTILO_ESTADO[e].etiqueta).toBeTruthy();
      expect(accionHacia(e)).toBeTruthy();
    }
  });

  it('formatea el tiempo restante y el vencido', () => {
    const ahora = new Date('2026-11-04T10:00:00-05:00');
    expect(tiempoRestante(new Date('2026-11-04T12:15:00-05:00'), ahora)).toBe('sale en 2 h 15 min');
    expect(tiempoRestante(new Date('2026-11-04T09:20:00-05:00'), ahora)).toBe('vencida hace 40 min');
    expect(tiempoRestante(new Date('2026-11-04T10:30:00-05:00'), ahora)).toBe('sale en 30 min');
  });
});
