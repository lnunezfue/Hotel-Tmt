import {
  aplicarAccion,
  codigoReserva,
  fechaLima,
  rangoPorHoras,
  rangoPorNoches,
  ReglaReservaError,
  rucValido,
  seCruzan,
  validarDocumento,
  validarHuespedes,
} from './reserva';

describe('rangos', () => {
  it('por noches: 14:00 de llegada a 12:00 de salida (hora de Lima = UTC−5)', () => {
    const r = rangoPorNoches('2026-11-30', 2);
    expect(r.entrada.toISOString()).toBe('2026-11-30T19:00:00.000Z');
    expect(r.salida.toISOString()).toBe('2026-12-02T17:00:00.000Z');
  });
  it('por horas desde la hora indicada', () => {
    const r = rangoPorHoras('2026-11-30', '22:30', 6, 1);
    expect(r.entrada.toISOString()).toBe('2026-12-01T03:30:00.000Z');
    expect(r.salida.toISOString()).toBe('2026-12-01T09:30:00.000Z');
  });
  it('rechaza noches y horas no válidas', () => {
    expect(() => rangoPorNoches('2026-11-30', 0)).toThrow(ReglaReservaError);
    expect(() => rangoPorHoras('2026-11-30', '25:00', 3, 1)).toThrow('Hora');
  });
  it('fechaLima usa la fecha local', () => {
    expect(fechaLima(new Date('2026-12-01T03:30:00Z'))).toBe('2026-11-30');
  });
  it('una salida a las 12:00 y una entrada a las 14:00 del mismo día no se cruzan', () => {
    expect(seCruzan(rangoPorNoches('2026-11-30', 2), rangoPorNoches('2026-12-02', 1))).toBe(false);
    expect(seCruzan(rangoPorNoches('2026-11-30', 2), rangoPorNoches('2026-12-01', 1))).toBe(true);
  });
});

describe('aplicarAccion', () => {
  const rango = rangoPorNoches('2026-11-30', 2);
  const antes = new Date('2026-11-29T15:00:00Z');
  const dia = new Date('2026-11-30T15:00:00Z');
  it('confirma solo pendientes', () => {
    expect(aplicarAccion('PENDIENTE', 'confirmar', rango, antes)).toBe('CONFIRMADA');
    expect(() => aplicarAccion('CONFIRMADA', 'confirmar', rango, antes)).toThrow('pendiente');
  });
  it('check-in desde el día de llegada, antes de la salida', () => {
    expect(() => aplicarAccion('CONFIRMADA', 'checkin', rango, antes)).toThrow('desde el 2026-11-30');
    expect(aplicarAccion('CONFIRMADA', 'checkin', rango, dia)).toBe('EN_CURSO');
    expect(() => aplicarAccion('CONFIRMADA', 'checkin', rango, new Date('2026-12-02T18:00:00Z'))).toThrow('venció');
  });
  it('no se presentó solo desde el día de llegada', () => {
    expect(() => aplicarAccion('PENDIENTE', 'no_show', rango, antes)).toThrow(ReglaReservaError);
    expect(aplicarAccion('PENDIENTE', 'no_show', rango, dia)).toBe('NO_SHOW');
  });
  it('no cancela una reserva en curso', () => {
    expect(() => aplicarAccion('EN_CURSO', 'cancelar', rango, dia)).toThrow('en curso');
  });
});

describe('validarHuespedes', () => {
  const doble = { adultos: 2, ninos: 1 };
  it('respeta la capacidad del tipo', () => {
    expect(() => validarHuespedes(2, 1, doble)).not.toThrow();
    expect(() => validarHuespedes(3, 0, doble)).toThrow('2 adultos');
    expect(() => validarHuespedes(2, 2, doble)).toThrow('3 personas');
    expect(() => validarHuespedes(0, 1, doble)).toThrow('al menos un adulto');
  });
});

describe('documentos', () => {
  it('DNI de 8 dígitos', () => {
    expect(validarDocumento('DNI', ' 45678912 ')).toBe('45678912');
    expect(() => validarDocumento('DNI', '4567891')).toThrow('8 dígitos');
  });
  it('RUC con dígito verificador', () => {
    expect(rucValido('20123456786')).toBe(true);
    expect(rucValido('20123456789')).toBe(false);
    expect(() => validarDocumento('RUC', '20123456788')).toThrow('RUC');
  });
  it('pasaporte alfanumérico en mayúsculas', () => {
    expect(validarDocumento('PASAPORTE', 'cl8834521')).toBe('CL8834521');
  });
  it('código de reserva', () => {
    expect(codigoReserva(42)).toBe('R-000042');
  });
});
