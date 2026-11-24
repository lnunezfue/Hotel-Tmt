import { liquidar, normalizarDatosLibro, ReglaEstanciaError, validarExtension, validarHuespedes } from './estancia';

describe('Datos del libro de huéspedes', () => {
  it('recorta y normaliza la placa', () => {
    expect(normalizarDatosLibro({ procedencia: ' Arica,  Chile ', motivoViaje: 'Turismo', placaVehiculo: ' abc-123 ' })).toEqual({
      procedencia: 'Arica, Chile',
      destino: null,
      motivoViaje: 'Turismo',
      placaVehiculo: 'ABC-123',
    });
  });

  it('exige procedencia y un motivo de la lista', () => {
    expect(() => normalizarDatosLibro({ procedencia: ' ', motivoViaje: 'Turismo' })).toThrow('procedencia');
    expect(() => normalizarDatosLibro({ procedencia: 'Lima', motivoViaje: 'Vacaciones' })).toThrow('motivo del viaje');
  });
});

describe('Huéspedes de la estancia', () => {
  it('no repite huéspedes ni pasa la capacidad', () => {
    expect(() => validarHuespedes(1n, [2n], 2)).not.toThrow();
    expect(() => validarHuespedes(1n, [1n], 2)).toThrow('más de una vez');
    expect(() => validarHuespedes(1n, [2n, 3n], 2)).toThrow('admite 2');
  });

  it('extiende de 1 a 30 turnos', () => {
    expect(() => validarExtension(1)).not.toThrow();
    expect(() => validarExtension(0)).toThrow(ReglaEstanciaError);
    expect(() => validarExtension(31)).toThrow(ReglaEstanciaError);
  });
});

describe('Liquidación del check-out', () => {
  const checkin = new Date('2026-11-24T14:00:00-05:00');
  const salida = (iso: string) => new Date(`${iso}-05:00`);
  const base = { checkin, horasTurno: 24, contratados: 1, precioCentimos: 7000 };

  it('cobra lo contratado aunque salga antes', () => {
    const l = liquidar({ ...base, salida: salida('2026-11-25T08:00:00') });
    expect(l).toMatchObject({ consumidos: 1, adicionales: 0, importeCentimos: 7000 });
  });

  it('no cobra otro turno dentro de los 30 minutos de tolerancia', () => {
    expect(liquidar({ ...base, salida: salida('2026-11-25T14:30:00') }).consumidos).toBe(1);
  });

  it('cobra otro turno pasada la tolerancia', () => {
    const l = liquidar({ ...base, salida: salida('2026-11-25T14:31:00') });
    expect(l).toMatchObject({ consumidos: 2, adicionales: 1, importeCentimos: 14000 });
  });

  it('cuenta varios turnos cortos', () => {
    const l = liquidar({ checkin, horasTurno: 3, contratados: 1, precioCentimos: 2450, salida: salida('2026-11-24T21:00:00') });
    expect(l).toMatchObject({ consumidos: 3, adicionales: 2, importeCentimos: 7350 });
  });
});
