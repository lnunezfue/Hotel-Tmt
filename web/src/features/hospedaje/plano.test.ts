import { describe, expect, it } from 'vitest';
import { buscarHueco, cabe, distribucionInicial, ladoPuerta, siguienteNumero } from './plano';

describe('plano (cliente)', () => {
  it('cabe: dentro del plano y sin chocar', () => {
    expect(cabe({ x: 0, y: 0, ancho: 3, alto: 2 }, 12, 6, [{ x: 3, y: 0, ancho: 3, alto: 2 }])).toBe(true);
    expect(cabe({ x: 1, y: 0, ancho: 3, alto: 2 }, 12, 6, [{ x: 3, y: 0, ancho: 3, alto: 2 }])).toBe(false);
    expect(cabe({ x: 10, y: 0, ancho: 3, alto: 2 }, 12, 6, [])).toBe(false);
  });
  it('misma distribución inicial que el servidor', () => {
    const d = distribucionInicial(8);
    expect([d.columnas, d.filas]).toEqual([13, 5]);
    expect(d.habitaciones[4]).toEqual({ x: 1, y: 3, ancho: 3, alto: 2 });
  });
  it('la puerta mira al pasillo', () => {
    const pasillo = { x: 1, y: 2, ancho: 12, alto: 1 };
    expect(ladoPuerta({ x: 1, y: 0, ancho: 3, alto: 2 }, [pasillo])).toBe('abajo');
    expect(ladoPuerta({ x: 1, y: 3, ancho: 3, alto: 2 }, [pasillo])).toBe('arriba');
  });
  it('busca hueco y numera', () => {
    expect(buscarHueco(6, 2, [{ x: 0, y: 0, ancho: 3, alto: 2 }], { ancho: 3, alto: 2 })).toEqual({ x: 3, y: 0, ancho: 3, alto: 2 });
    expect(siguienteNumero(4, ['401', '402'])).toBe('403');
  });
});
