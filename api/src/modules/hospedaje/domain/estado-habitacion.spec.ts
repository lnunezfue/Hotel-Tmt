import { alertaSalida, calcularSalidaPrevista, TransicionInvalidaError, transicionesPermitidas, validarTransicion } from './estado-habitacion';

describe('Máquina de estados de la habitación', () => {
  it('permite el ciclo normal desocupada → ocupada → limpieza → desocupada', () => {
    expect(() => validarTransicion('DESOCUPADA', 'OCUPADA')).not.toThrow();
    expect(() => validarTransicion('OCUPADA', 'LIMPIEZA')).not.toThrow();
    expect(() => validarTransicion('LIMPIEZA', 'DESOCUPADA')).not.toThrow();
  });

  it('no deja liberar una habitación ocupada sin pasar por limpieza', () => {
    expect(() => validarTransicion('OCUPADA', 'DESOCUPADA')).toThrow(TransicionInvalidaError);
  });

  it('rechaza quedarse en el mismo estado', () => {
    expect(() => validarTransicion('LIMPIEZA', 'LIMPIEZA')).toThrow(TransicionInvalidaError);
  });

  it('desde mantenimiento solo se vuelve a desocupada', () => {
    expect(transicionesPermitidas('MANTENIMIENTO')).toEqual(['DESOCUPADA']);
  });
});

describe('Turnos y salida prevista', () => {
  const checkin = new Date('2026-11-04T14:00:00-05:00');

  it.each([
    [3, 1, '2026-11-04T17:00:00-05:00'],
    [6, 1, '2026-11-04T20:00:00-05:00'],
    [12, 1, '2026-11-05T02:00:00-05:00'],
    [24, 2, '2026-11-06T14:00:00-05:00'],
  ])('turno de %i h × %i', (horas, cantidad, esperado) => {
    expect(calcularSalidaPrevista(checkin, horas, cantidad).toISOString()).toBe(new Date(esperado).toISOString());
  });

  it('rechaza turnos que no existen', () => {
    expect(() => calcularSalidaPrevista(checkin, 5, 1)).toThrow('Turno no válido');
  });

  it('marca la estancia vencida o por vencer', () => {
    const salida = new Date('2026-11-04T17:00:00-05:00');
    expect(alertaSalida(salida, new Date('2026-11-04T17:10:00-05:00'))).toBe('VENCIDA');
    expect(alertaSalida(salida, new Date('2026-11-04T16:45:00-05:00'))).toBe('POR_VENCER');
    expect(alertaSalida(salida, new Date('2026-11-04T15:00:00-05:00'))).toBeNull();
  });
});
