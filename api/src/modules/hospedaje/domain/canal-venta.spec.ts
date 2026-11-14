import { normalizarNombreCanal, ReglaCanalError, validarComision } from './canal-venta';

describe('canal de venta', () => {
  it('recorta el nombre', () => {
    expect(normalizarNombreCanal('  Expedia ')).toBe('Expedia');
  });

  it.each(['B', '  B  ', 'x'.repeat(61)])('rechaza el nombre «%s»', (nombre) => {
    expect(() => normalizarNombreCanal(nombre)).toThrow(ReglaCanalError);
  });

  it.each([0, 100, 15.5, 12.25])('acepta la comisión %s', (valor) => {
    expect(() => validarComision(valor)).not.toThrow();
  });

  it.each([-1, 100.01, 12.345, Number.NaN, Number.POSITIVE_INFINITY])('rechaza la comisión %s', (valor) => {
    expect(() => validarComision(valor)).toThrow(ReglaCanalError);
  });
});
