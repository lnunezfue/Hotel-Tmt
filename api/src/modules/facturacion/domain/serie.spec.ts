import { elegirSerie, normalizarSerie, ReglaSerieError, validarCorrelativoInicial } from './serie';

describe('Formato de la serie', () => {
  it('exige el prefijo de SUNAT por tipo', () => {
    expect(normalizarSerie('FACTURA', ' f001 ')).toBe('F001');
    expect(normalizarSerie('BOLETA', 'B002')).toBe('B002');
    expect(normalizarSerie('NOTA_CREDITO', 'FC01')).toBe('FC01');
    expect(normalizarSerie('NOTA_CREDITO', 'BC01')).toBe('BC01');
    expect(normalizarSerie('INTERNO', 'I001')).toBe('I001');
    expect(() => normalizarSerie('FACTURA', 'B001')).toThrow('F y 3');
    expect(() => normalizarSerie('BOLETA', 'B01')).toThrow(ReglaSerieError);
    expect(() => normalizarSerie('BOLETA', 'B0011')).toThrow(ReglaSerieError);
    expect(() => normalizarSerie('NOTA_DEBITO', 'XD01')).toThrow(ReglaSerieError);
  });

  it('acepta un número inicial de 0 a 99 999 999', () => {
    expect(() => validarCorrelativoInicial(0)).not.toThrow();
    expect(() => validarCorrelativoInicial(1520)).not.toThrow();
    expect(() => validarCorrelativoInicial(-1)).toThrow(ReglaSerieError);
    expect(() => validarCorrelativoInicial(1.5)).toThrow(ReglaSerieError);
  });
});

describe('Elección de la serie al emitir', () => {
  const libre = { id: 1, serie: 'B001', usuarios: [] };
  const deCaja1 = { id: 2, serie: 'B002', usuarios: [7] };
  const deCaja2 = { id: 3, serie: 'B003', usuarios: [8, 9] };

  it('usa la serie propia del usuario', () => {
    expect(elegirSerie([libre, deCaja1, deCaja2], 7, 'BOLETA').id).toBe(2);
    expect(elegirSerie([libre, deCaja1, deCaja2], 9, 'BOLETA').id).toBe(3);
  });

  it('sin serie propia usa una libre y nunca la de otro usuario', () => {
    expect(elegirSerie([libre, deCaja1], 5, 'BOLETA').id).toBe(1);
    expect(() => elegirSerie([deCaja1, deCaja2], 5, 'BOLETA')).toThrow('No tienes una serie de boleta');
  });

  it('respeta la serie pedida solo si el usuario puede usarla', () => {
    expect(elegirSerie([libre, { id: 4, serie: 'B004', usuarios: [] }], 5, 'BOLETA', 4).id).toBe(4);
    expect(() => elegirSerie([libre, deCaja1], 5, 'BOLETA', 2)).toThrow('esa serie');
  });
});
