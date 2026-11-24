import {
  normalizarMotivo,
  ReglaReservaError,
  seCruzan,
  siguienteCodigo,
  validarAnular,
  validarCantidades,
  validarCheckinDeReserva,
  validarConfirmar,
  validarNoShow,
} from './reserva';

describe('Estados de la reserva', () => {
  it('solo confirma una reserva pendiente', () => {
    expect(() => validarConfirmar('PENDIENTE')).not.toThrow();
    expect(() => validarConfirmar('CONFIRMADA')).toThrow(ReglaReservaError);
  });

  it('anula mientras nadie haya ingresado', () => {
    expect(() => validarAnular('PENDIENTE')).not.toThrow();
    expect(() => validarAnular('CONFIRMADA')).not.toThrow();
    expect(() => validarAnular('EN_CURSO')).toThrow('en curso');
    expect(() => validarAnular('CANCELADA')).toThrow('anulada');
  });

  it('marca no-show solo pasada la hora de entrada', () => {
    const entrada = new Date('2026-11-24T14:00:00-05:00');
    expect(() => validarNoShow('CONFIRMADA', entrada, new Date('2026-11-24T13:59:00-05:00'))).toThrow('aún no llega');
    expect(() => validarNoShow('CONFIRMADA', entrada, new Date('2026-11-24T14:00:00-05:00'))).not.toThrow();
    expect(() => validarNoShow('EN_CURSO', entrada, new Date('2026-11-25T14:00:00-05:00'))).toThrow(ReglaReservaError);
  });

  it('admite el check-in de cada habitación mientras la reserva siga vigente', () => {
    expect(() => validarCheckinDeReserva('EN_CURSO')).not.toThrow();
    expect(() => validarCheckinDeReserva('NO_SHOW')).toThrow(ReglaReservaError);
  });

  it('exige un motivo de 5 a 250 caracteres', () => {
    expect(normalizarMotivo('  Cliente   canceló por teléfono ')).toBe('Cliente canceló por teléfono');
    expect(() => normalizarMotivo('no')).toThrow('motivo');
    expect(() => normalizarMotivo('x'.repeat(251))).toThrow('motivo');
  });
});

describe('Datos de la reserva', () => {
  it('valida turnos y personas', () => {
    expect(() => validarCantidades({ cantidadTurnos: 2, adultos: 2, ninos: 0 })).not.toThrow();
    expect(() => validarCantidades({ cantidadTurnos: 0, adultos: 1, ninos: 0 })).toThrow('turnos');
    expect(() => validarCantidades({ cantidadTurnos: 1.5, adultos: 1, ninos: 0 })).toThrow('turnos');
    expect(() => validarCantidades({ cantidadTurnos: 1, adultos: 0, ninos: 0 })).toThrow('adultos');
    expect(() => validarCantidades({ cantidadTurnos: 1, adultos: 1, ninos: -1 })).toThrow('niños');
  });

  it('detecta rangos que se cruzan; los que solo se tocan no', () => {
    const h = (x: number) => new Date(Date.UTC(2026, 10, 24, x));
    expect(seCruzan({ inicio: h(10), fin: h(14) }, { inicio: h(13), fin: h(16) })).toBe(true);
    expect(seCruzan({ inicio: h(10), fin: h(14) }, { inicio: h(14), fin: h(16) })).toBe(false);
    expect(seCruzan({ inicio: h(10), fin: h(20) }, { inicio: h(12), fin: h(13) })).toBe(true);
  });

  it('numera las reservas por año', () => {
    expect(siguienteCodigo(2026, null)).toBe('R-2026-000001');
    expect(siguienteCodigo(2026, 'R-2026-000123')).toBe('R-2026-000124');
    expect(() => siguienteCodigo(2026, 'X-1')).toThrow('inesperado');
  });
});
