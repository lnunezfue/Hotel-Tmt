import { calcularDescuento, desglosarIgv, totalesComprobante, validarReceptorBoleta } from '../../estancias/domain/cobro';
import { armarComprobante, ComprobanteGuardado, EstructuraComprobanteError } from './comprobante';

describe('Descuento global', () => {
  it('separa base e IGV de un descuento en soles', () => {
    expect(calcularDescuento(24_000, 0, { tipo: 'MONTO', valor: 23.6, motivo: 'Cliente frecuente' })).toEqual({ conIgv: 2360, base: 2000, igv: 360, motivo: 'Cliente frecuente' });
  });

  it('calcula el porcentaje sobre el total', () => {
    expect(calcularDescuento(24_000, 0, { tipo: 'PORCENTAJE', valor: 10, motivo: 'Convenio empresa' }).conIgv).toBe(2400);
  });

  it('no deja el total por debajo del adelanto ni acepta motivos cortos', () => {
    expect(() => calcularDescuento(24_000, 20_000, { tipo: 'MONTO', valor: 50, motivo: 'Cortesía de gerencia' })).toThrow('adelanto');
    expect(() => calcularDescuento(24_000, 0, { tipo: 'MONTO', valor: 241, motivo: 'Cortesía de gerencia' })).toThrow('superar el total');
    expect(() => calcularDescuento(24_000, 0, { tipo: 'PORCENTAJE', valor: 101, motivo: 'Cortesía de gerencia' })).toThrow('100');
    expect(() => calcularDescuento(24_000, 0, { tipo: 'MONTO', valor: 10, motivo: 'no' })).toThrow('motivo');
    expect(() => calcularDescuento(24_000, 0, { tipo: 'MONTO', valor: 10.005, motivo: 'Cortesía de gerencia' })).toThrow('dos decimales');
  });

  it('resta el descuento de la base y del IGV sin tocar las líneas', () => {
    const t = totalesComprobante([{ total: '120.00' }, { total: '120.00' }], { base: 2000, igv: 360 });
    expect(t).toEqual({ gravada: '183.38', igv: '33.02', total: '216.40', descuentoBase: '20.00', descuentoIgv: '3.60' });
  });

  it('exige identificar al comprador de una boleta de más de S/ 700', () => {
    expect(() => validarReceptorBoleta(70_000, '0')).not.toThrow();
    expect(() => validarReceptorBoleta(70_001, '0')).toThrow('S/ 700');
    expect(() => validarReceptorBoleta(90_000, '1')).not.toThrow();
  });
});

describe('Estructura del comprobante', () => {
  const linea = (total: number) => {
    const d = desglosarIgv(Math.round(total * 100));
    return { descripcion: 'Hospedaje', cantidad: 1, valorUnitario: d.valorVenta / 100, precioUnitario: total, valorVenta: d.valorVenta / 100, igv: d.igv / 100, total, afectacionIgv: '10' };
  };
  const base: ComprobanteGuardado = {
    rucEmisor: '20123456789',
    tipo: 'BOLETA',
    serie: 'B001',
    numero: 15,
    fechaEmision: '2026-11-25',
    moneda: 'PEN',
    cliente: { tipoDocumento: '1', numeroDocumento: '45678912', nombre: 'Carlos Mendoza' },
    lineas: [linea(120), linea(120)],
    totales: { gravada: 183.38, exonerada: 0, inafecta: 0, igv: 33.02, descuentoBase: 20, descuentoIgv: 3.6, total: 216.4 },
  };

  it('arma la boleta con el descuento global aparte de las líneas', () => {
    const e = armarComprobante(base);
    expect(e.claveIdempotencia).toBe('20123456789-03-B001-15');
    expect(e.items).toHaveLength(2);
    expect(e.items[0].total).toBe(120);
    expect(e.totales).toEqual({ gravada: 183.38, exonerada: 0, inafecta: 0, igv: 33.02, descuentoGlobal: 20, total: 216.4 });
  });

  it('rechaza lo que no cuadra o no corresponde', () => {
    expect(() => armarComprobante({ ...base, totales: { ...base.totales, total: 216.41 } })).toThrow('total no cuadra');
    expect(() => armarComprobante({ ...base, tipo: 'FACTURA', serie: 'F001' })).toThrow('RUC');
    expect(() => armarComprobante({ ...base, serie: 'F001' })).toThrow(EstructuraComprobanteError);
    expect(() => armarComprobante({ ...base, tipo: 'INTERNO', serie: 'I001' })).toThrow('no se envía');
  });
});
