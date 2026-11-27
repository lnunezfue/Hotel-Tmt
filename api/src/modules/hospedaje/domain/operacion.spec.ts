import {
  estadoLimpieza,
  FRANJAS_SUGERIDAS,
  franjaDe,
  ReglaOperacionError,
  salidaMaxima,
  salidaNoche,
  salidaPorHoras,
  validarFranjas,
  validarMinutosLimpieza,
} from './operacion';

/** Instante de Lima (UTC−5) como Date. */
const lima = (fechaHora: string) => new Date(`${fechaHora}:00-05:00`);

describe('franjas de salida', () => {
  it.each([
    ['2026-11-26T02:30', 'Madrugada', '2026-11-26T12:00'],
    ['2026-11-26T05:59', 'Madrugada', '2026-11-26T12:00'],
    ['2026-11-26T06:00', 'Mañana', '2026-11-26T18:00'],
    ['2026-11-26T11:40', 'Mañana', '2026-11-26T18:00'],
    ['2026-11-26T12:00', 'Tarde y noche', '2026-11-27T06:00'],
    ['2026-11-26T23:59', 'Tarde y noche', '2026-11-27T06:00'],
  ])('un check-in a las %s cae en %s y sale a más tardar %s', (checkin, franja, maxima) => {
    const f = franjaDe(lima(checkin), FRANJAS_SUGERIDAS)!;
    expect(f.nombre).toBe(franja);
    expect(salidaMaxima(lima(checkin), f)).toEqual(lima(maxima));
  });

  it('por horas: el check-in más las horas compradas (el promedio son 4 h)', () => {
    expect(salidaPorHoras(lima('2026-11-26T21:15'), 4, 1, FRANJAS_SUGERIDAS)).toEqual({ salida: lima('2026-11-27T01:15'), maxima: lima('2026-11-27T06:00') });
  });

  it('por horas: rechaza lo que pasa la hora máxima y dice cuántos turnos caben', () => {
    expect(() => salidaPorHoras(lima('2026-11-26T23:00'), 4, 2, FRANJAS_SUGERIDAS)).toThrow('salida máxima es a las 06:00 del día siguiente. Caben 1 turno de 4 h');
    expect(() => salidaPorHoras(lima('2026-11-26T15:00'), 12, 2, FRANJAS_SUGERIDAS)).toThrow(ReglaOperacionError);
    expect(() => salidaPorHoras(lima('2026-11-26T05:00'), 12, 1, FRANJAS_SUGERIDAS)).toThrow('No cabe un turno de 12 h');
  });

  it('justo en la hora máxima se acepta', () => {
    expect(salidaPorHoras(lima('2026-11-26T08:00'), 10, 1, [{ nombre: 'Mañana', desde: '06:00', hasta: '12:00', salidaMaxima: '18:00', diasDespues: 0 }]).salida).toEqual(lima('2026-11-26T18:00'));
  });

  it('los segundos del check-in no cuentan contra la hora máxima', () => {
    const conSegundos = new Date(lima('2026-11-26T10:00').getTime() + 12_000);
    expect(salidaPorHoras(conSegundos, 4, 2, FRANJAS_SUGERIDAS).salida.getTime()).toBe(lima('2026-11-26T18:00').getTime() + 12_000);
    expect(() => salidaPorHoras(lima('2026-11-26T10:01'), 4, 2, FRANJAS_SUGERIDAS)).toThrow('Caben 1 turno');
  });

  it('sin franjas no hay tope', () => {
    expect(salidaPorHoras(lima('2026-11-26T23:00'), 12, 2, []).maxima).toBeNull();
  });

  it('valida las franjas: orden, cruces y salida posterior al final', () => {
    expect(validarFranjas([...FRANJAS_SUGERIDAS].reverse()).map((f) => f.nombre)).toEqual(['Madrugada', 'Mañana', 'Tarde y noche']);
    expect(() => validarFranjas([FRANJAS_SUGERIDAS[0], { ...FRANJAS_SUGERIDAS[1], desde: '05:00' }])).toThrow('se cruzan');
    expect(() => validarFranjas([{ nombre: 'Mal', desde: '12:00', hasta: '00:00', salidaMaxima: '18:00', diasDespues: 0 }])).toThrow('llega antes de que termine');
    expect(() => validarFranjas([{ nombre: 'Al revés', desde: '10:00', hasta: '08:00', salidaMaxima: '18:00', diasDespues: 0 }])).toThrow('termina antes de empezar');
    expect(() => validarFranjas([{ nombre: 'x', desde: '10:00', hasta: '12:00', salidaMaxima: '18:00', diasDespues: 0 }])).toThrow('nombre');
    expect(() => validarFranjas([{ nombre: 'Hora', desde: '25:00', hasta: '12:00', salidaMaxima: '18:00', diasDespues: 0 }])).toThrow('Hora no válida');
  });
});

describe('salida de la noche', () => {
  it('quien entra en la tarde o la noche sale a las 9:00 del día siguiente', () => {
    expect(salidaNoche(lima('2026-11-26T20:30'), '09:00', 1)).toEqual(lima('2026-11-27T09:00'));
    expect(salidaNoche(lima('2026-11-26T10:00'), '09:00', 1)).toEqual(lima('2026-11-27T09:00'));
  });

  it('quien entra de madrugada sale a las 9:00 del mismo día', () => {
    expect(salidaNoche(lima('2026-11-26T02:00'), '09:00', 1)).toEqual(lima('2026-11-26T09:00'));
    expect(salidaNoche(lima('2026-11-26T06:00'), '09:00', 1)).toEqual(lima('2026-11-26T09:00'));
    // Con menos de 3 h por delante ya no es «esta noche»
    expect(salidaNoche(lima('2026-11-26T06:30'), '09:00', 1)).toEqual(lima('2026-11-27T09:00'));
  });

  it('varias noches suman días', () => {
    expect(salidaNoche(lima('2026-11-26T22:00'), '09:00', 3)).toEqual(lima('2026-11-29T09:00'));
  });
});

describe('limpieza', () => {
  it('avisa cuando pasa el tiempo esperado', () => {
    expect(estadoLimpieza(lima('2026-11-26T10:00'), lima('2026-11-26T10:25'), 30)).toEqual({ minutos: 25, demorada: false });
    expect(estadoLimpieza(lima('2026-11-26T10:00'), lima('2026-11-26T10:31'), 30)).toEqual({ minutos: 31, demorada: true });
    expect(() => validarMinutosLimpieza(2)).toThrow('de 5 a 240');
  });
});
