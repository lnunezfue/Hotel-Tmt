import { canalDe, leerAviso, mensajeDe } from './aviso-tablero';

describe('aviso-tablero', () => {
  it('arma el canal y el mensaje', () => {
    expect(canalDe(7)).toBe('tablero:sucursal:7');
    expect(mensajeDe({ sucursalId: 7, motivo: 'estado' })).toBe('{"motivo":"estado"}');
  });

  it('lee un aviso válido', () => {
    expect(leerAviso('tablero:sucursal:7', '{"motivo":"piso"}')).toEqual({ sucursalId: 7, motivo: 'piso' });
  });

  it.each([
    ['tablero:sucursal:7', 'no es json'],
    ['tablero:sucursal:7', '{"motivo":"otro"}'],
    ['tablero:sucursal:7', '{}'],
    ['tablero:sucursal:7', 'null'],
    ['tablero:sucursal:abc', '{"motivo":"estado"}'],
    ['tablero:sucursal:0', '{"motivo":"estado"}'],
    ['tablero:sucursal:7:x', '{"motivo":"estado"}'],
    ['otro:canal', '{"motivo":"estado"}'],
  ])('descarta %s %s', (canal, mensaje) => {
    expect(leerAviso(canal, mensaje)).toBeNull();
  });
});
