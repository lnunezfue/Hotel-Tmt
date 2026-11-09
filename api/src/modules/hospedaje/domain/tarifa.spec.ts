import { esFecha, hoyLima, planificarTarifa, ReglaTarifaError, sumarDias, tarifaProgramada, tarifaVigente, validarPrecio } from './tarifa';

const t = (id: number, desde: string, hasta: string | null = null, activo = true) => ({ id, desde, hasta, activo });

describe('fechas', () => {
  it('hoyLima usa UTC−5', () => {
    expect(hoyLima(new Date('2026-11-10T03:00:00Z'))).toBe('2026-11-09');
    expect(hoyLima(new Date('2026-11-10T05:00:00Z'))).toBe('2026-11-10');
  });
  it('sumarDias cruza meses y años', () => {
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('esFecha rechaza fechas imposibles', () => {
    expect(esFecha('2026-02-30')).toBe(false);
    expect(esFecha('2026-2-3')).toBe(false);
    expect(esFecha('2026-02-28')).toBe(true);
  });
});

describe('tarifaVigente', () => {
  const tarifas = [t(1, '2026-01-01', '2026-11-14'), t(2, '2026-11-15'), t(3, '2026-06-01', null, false)];
  it('elige la que cubre la fecha', () => {
    expect(tarifaVigente(tarifas, '2026-11-09')?.id).toBe(1);
    expect(tarifaVigente(tarifas, '2026-11-15')?.id).toBe(2);
  });
  it('ignora inactivas y devuelve null antes de la primera', () => {
    expect(tarifaVigente(tarifas, '2025-12-31')).toBeNull();
    expect(tarifaVigente([t(3, '2026-06-01', null, false)], '2026-07-01')).toBeNull();
  });
  it('si dos se superponen gana la más reciente', () => {
    expect(tarifaVigente([t(1, '2026-01-01'), t(2, '2026-05-01')], '2026-06-01')?.id).toBe(2);
  });
  it('tarifaProgramada devuelve el próximo cambio', () => {
    expect(tarifaProgramada(tarifas, '2026-11-09')?.id).toBe(2);
    expect(tarifaProgramada(tarifas, '2026-11-15')).toBeNull();
  });
});

describe('planificarTarifa', () => {
  const hoy = '2026-11-09';
  it('cierra la vigente el día anterior', () => {
    expect(planificarTarifa([t(1, '2026-01-01')], '2026-11-20', hoy)).toEqual({ cerrar: [{ id: 1, hasta: '2026-11-19' }] });
  });
  it('desde hoy también cierra la vigente (hasta ayer)', () => {
    expect(planificarTarifa([t(1, '2026-01-01')], hoy, hoy).cerrar).toEqual([{ id: 1, hasta: '2026-11-08' }]);
  });
  it('sin tarifa previa no cierra nada', () => {
    expect(planificarTarifa([], hoy, hoy).cerrar).toEqual([]);
  });
  it('no deja de lado tarifas ya cerradas antes', () => {
    expect(planificarTarifa([t(1, '2026-01-01', '2026-03-31'), t(2, '2026-04-01')], '2026-12-01', hoy).cerrar).toEqual([{ id: 2, hasta: '2026-11-30' }]);
  });
  it('rechaza fechas pasadas, duplicadas o anteriores a un cambio programado', () => {
    expect(() => planificarTarifa([], '2026-11-08', hoy)).toThrow(ReglaTarifaError);
    expect(() => planificarTarifa([t(1, '2026-11-20')], '2026-11-20', hoy)).toThrow('Ya hay una tarifa');
    expect(() => planificarTarifa([t(1, '2026-01-01', '2026-11-19'), t(2, '2026-11-20')], '2026-11-15', hoy)).toThrow('cambio programado');
  });
});

describe('validarPrecio', () => {
  it.each([0, -5, 100_000, 10.555, Number.NaN])('rechaza %p', (p) => {
    expect(() => validarPrecio(p)).toThrow(ReglaTarifaError);
  });
  it.each([0.5, 70, 99_999, 12.3])('acepta %p', (p) => {
    expect(() => validarPrecio(p)).not.toThrow();
  });
});
