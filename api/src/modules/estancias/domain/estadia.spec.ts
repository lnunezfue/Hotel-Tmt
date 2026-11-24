import { normalizarLibro, normalizarMotivoTraslado, ReglaEstadiaError, salidaExtendida, seCruzan, turnosAdicionales, validarExtension } from './estadia';

describe('Salida tardía', () => {
  const salida = new Date('2026-11-25T12:00:00-05:00');
  const a = (hora: string) => new Date(`2026-11-25T${hora}:00-05:00`);

  it('no suma turnos si sale antes o dentro de los 30 minutos de tolerancia', () => {
    expect(turnosAdicionales(salida, a('10:00'), 24)).toBe(0);
    expect(turnosAdicionales(salida, a('12:30'), 24)).toBe(0);
  });

  it('suma un turno pasada la tolerancia', () => {
    expect(turnosAdicionales(salida, a('12:31'), 24)).toBe(1);
  });

  it('cuenta turnos cortos por cada fracción pasada', () => {
    expect(turnosAdicionales(salida, a('14:00'), 3)).toBe(1);
    expect(turnosAdicionales(salida, a('15:10'), 3)).toBe(2);
  });
});

describe('Extensión y traslado', () => {
  it('extiende de 1 a 30 turnos', () => {
    expect(() => validarExtension(1)).not.toThrow();
    expect(() => validarExtension(0)).toThrow(ReglaEstadiaError);
    expect(() => validarExtension(31)).toThrow(ReglaEstadiaError);
    expect(() => validarExtension(1.5)).toThrow(ReglaEstadiaError);
  });

  it('corre la salida por turnos completos', () => {
    const s = new Date('2026-11-25T12:00:00-05:00');
    expect(salidaExtendida(s, 24, 2).toISOString()).toBe(new Date('2026-11-27T12:00:00-05:00').toISOString());
  });

  it('exige un motivo de traslado de 5 a 200 caracteres', () => {
    expect(normalizarMotivoTraslado('  Fuga de   agua en el baño ')).toBe('Fuga de agua en el baño');
    expect(() => normalizarMotivoTraslado('ruido')).not.toThrow();
    expect(() => normalizarMotivoTraslado('no')).toThrow(ReglaEstadiaError);
  });

  it('detecta cruces; los rangos que solo se tocan no se cruzan', () => {
    const h = (x: number) => new Date(Date.UTC(2026, 10, 25, x));
    expect(seCruzan({ inicio: h(10), fin: h(14) }, { inicio: h(13), fin: h(16) })).toBe(true);
    expect(seCruzan({ inicio: h(10), fin: h(14) }, { inicio: h(14), fin: h(16) })).toBe(false);
  });
});

describe('Libro de huéspedes', () => {
  it('acepta un motivo de la lista y recorta el destino', () => {
    expect(normalizarLibro({ destino: '  Cusco ', motivoViaje: 'Turismo' })).toEqual({ destino: 'Cusco', motivoViaje: 'Turismo' });
    expect(normalizarLibro({})).toEqual({ destino: null, motivoViaje: null });
  });

  it('rechaza un motivo fuera de la lista', () => {
    expect(() => normalizarLibro({ motivoViaje: 'Vacaciones' })).toThrow('motivo del viaje');
  });
});
