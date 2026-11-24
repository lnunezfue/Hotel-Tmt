import { aCentimos, comision, desglosarIgv, montoEnLetras, ReglaCobroError, repartirPagos, totalesComprobante } from './cobro';

const efectivo = (monto: number) => ({ metodo: 'EFECTIVO', esEfectivo: true, monto });
const yape = (monto: number) => ({ metodo: 'YAPE', esEfectivo: false, monto });

describe('IGV incluido', () => {
  it('118.00 = 100.00 + 18.00', () => {
    expect(desglosarIgv(11800)).toEqual({ valorVenta: 10000, igv: 1800, total: 11800 });
  });
  it('los totales cuadran con la suma de líneas', () => {
    const t = totalesComprobante([{ total: '70.00' }, { total: '3.50' }, { total: '4.00' }]);
    expect(Number(t.gravada) + Number(t.igv)).toBeCloseTo(77.5, 2);
    expect(t.total).toBe('77.50');
  });
});

describe('repartirPagos', () => {
  it('efectivo de más da vuelto y se registra solo lo cobrado', () => {
    const r = repartirPagos(aCentimos(87.5), [efectivo(100)]);
    expect(r.vuelto).toBe(1250);
    expect(r.registrados).toEqual([efectivo(87.5)]);
  });
  it('pago mixto exacto', () => {
    const r = repartirPagos(aCentimos(150), [yape(100), efectivo(50)]);
    expect(r.vuelto).toBe(0);
    expect(r.registrados).toHaveLength(2);
  });
  it('falta dinero', () => {
    expect(() => repartirPagos(aCentimos(150), [yape(100)])).toThrow('Falta cobrar S/ 50.00');
  });
  it('no hay vuelto con Yape o tarjeta', () => {
    expect(() => repartirPagos(aCentimos(50), [yape(60)])).toThrow(ReglaCobroError);
  });
  it('saldo cero sin pagos', () => {
    expect(repartirPagos(0, [])).toEqual({ registrados: [], vuelto: 0 });
  });
});

describe('comisión', () => {
  it('15 % de 230.00', () => {
    expect(comision(23000, '15.00')).toBe(3450);
  });
});

describe('montoEnLetras', () => {
  it.each([
    [0, 'CERO CON 00/100 SOLES'],
    [100, 'CIEN CON 00/100 SOLES'],
    [121.5, 'CIENTO VEINTIUNO CON 50/100 SOLES'],
    [1250, 'MIL DOSCIENTOS CINCUENTA CON 00/100 SOLES'],
    [21345.07, 'VEINTIUN MIL TRESCIENTOS CUARENTA Y CINCO CON 07/100 SOLES'],
    [1_000_000, 'UN MILLÓN CON 00/100 SOLES'],
  ])('%p', (n, texto) => {
    expect(montoEnLetras(n)).toBe(texto);
  });
});
