import { buscarHueco, distribucionInicial, ReglaPlanoError, seSuperponen, ubicarPendientes, validarPlano } from './plano';

const r = (x: number, y: number, ancho = 3, alto = 2) => ({ x, y, ancho, alto });

describe('seSuperponen', () => {
  it('bordes que se tocan no se superponen', () => {
    expect(seSuperponen(r(0, 0), r(3, 0))).toBe(false);
    expect(seSuperponen(r(0, 0), r(0, 2))).toBe(false);
  });
  it('detecta una celda compartida', () => {
    expect(seSuperponen(r(0, 0), r(2, 1))).toBe(true);
  });
});

describe('validarPlano', () => {
  it('acepta piezas dentro y sin superponerse', () => {
    expect(() => validarPlano(12, 6, [{ ...r(0, 0), nombre: 'habitación 101' }, { ...r(3, 0), nombre: 'habitación 102' }])).not.toThrow();
  });
  it('rechaza piezas fuera del plano', () => {
    expect(() => validarPlano(12, 6, [{ ...r(10, 0), nombre: 'habitación 104' }])).toThrow('Habitación 104 queda fuera del plano');
  });
  it('nombra las piezas que chocan', () => {
    expect(() => validarPlano(12, 6, [{ ...r(0, 0), nombre: 'habitación 101' }, { ...r(1, 1, 1, 1), nombre: 'la escalera' }])).toThrow(
      'Habitación 101 se superpone con la escalera',
    );
  });
  it('limita el tamaño del plano', () => {
    expect(() => validarPlano(3, 6, [])).toThrow(ReglaPlanoError);
    expect(() => validarPlano(12, 21, [])).toThrow(ReglaPlanoError);
  });
});

describe('buscarHueco y ubicarPendientes', () => {
  it('encuentra el primer hueco libre', () => {
    expect(buscarHueco(12, 6, [r(0, 0)], { ancho: 3, alto: 2 })).toEqual(r(3, 0));
  });
  it('agrega filas cuando no caben', () => {
    const ocupados = [r(0, 0), r(3, 0)];
    const res = ubicarPendientes(6, 2, ocupados, [{ id: 7, ancho: 3, alto: 2 }]);
    expect(res.filas).toBe(4);
    expect(res.posiciones.get(7)).toEqual(r(0, 2));
  });
});

describe('distribucionInicial', () => {
  it('ocho habitaciones: cuatro arriba, pasillo y cuatro abajo, sin superponerse', () => {
    const d = distribucionInicial(8);
    expect(d.columnas).toBe(13);
    expect(d.filas).toBe(5);
    expect(d.habitaciones.filter((h) => h.y === 0)).toHaveLength(4);
    expect(d.habitaciones.filter((h) => h.y === 3)).toHaveLength(4);
    const piezas = [...d.habitaciones.map((h, i) => ({ ...h, nombre: `h${i}` })), { ...d.pasillo, nombre: 'pasillo' }, { ...d.escalera, nombre: 'escalera' }];
    expect(() => validarPlano(d.columnas, d.filas, piezas)).not.toThrow();
  });
  it('un piso sin habitaciones igual tiene pasillo', () => {
    const d = distribucionInicial(0);
    expect(d.habitaciones).toEqual([]);
    expect(d.pasillo.ancho).toBe(d.columnas - 1);
  });
});
