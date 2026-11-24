import { normalizarNombreTurno, ReglaTurnoError, validarDuracionTurno } from './turno';

describe('turno', () => {
  it('recorta el nombre', () => {
    expect(normalizarNombreTurno('  Turno noche ')).toBe('Turno noche');
  });

  it.each(['T', ' T ', 'x'.repeat(31)])('rechaza el nombre «%s»', (nombre) => {
    expect(() => normalizarNombreTurno(nombre)).toThrow(ReglaTurnoError);
  });

  it.each([1, 3, 12, 24])('acepta %s horas', (horas) => {
    expect(() => validarDuracionTurno(horas)).not.toThrow();
  });

  it.each([0, 25, 2.5, -3, Number.NaN])('rechaza %s horas', (horas) => {
    expect(() => validarDuracionTurno(horas)).toThrow(ReglaTurnoError);
  });
});
