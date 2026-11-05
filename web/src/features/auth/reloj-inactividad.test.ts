import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearRelojInactividad } from './reloj-inactividad';

const MIN = 60_000;

function montar() {
  const alAvisar = vi.fn();
  const alReanudar = vi.fn();
  const alCerrar = vi.fn();
  const inicio = Date.now();
  const reloj = crearRelojInactividad({ limiteMs: 30 * MIN, avisoMs: 60_000, alAvisar, alReanudar, alCerrar });
  return { reloj, alAvisar, alReanudar, alCerrar, inicio };
}

describe('reloj de inactividad', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('avisa 60 s antes del límite', () => {
    const { alAvisar, inicio } = montar();
    vi.advanceTimersByTime(28 * MIN + 59_000);
    expect(alAvisar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(alAvisar).toHaveBeenCalledTimes(1);
    expect(alAvisar).toHaveBeenCalledWith(inicio + 30 * MIN);
  });

  it('la actividad reinicia el conteo y oculta el aviso', () => {
    const { reloj, alReanudar, alCerrar } = montar();
    vi.advanceTimersByTime(29 * MIN + 30_000);
    reloj.registrarActividad();
    expect(alReanudar).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(alCerrar).not.toHaveBeenCalled(); // minuto 30 desde el inicio
    vi.advanceTimersByTime(29 * MIN + 30_000); // minuto 59:30
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  it('cierra al llegar al límite', () => {
    const { alCerrar } = montar();
    vi.advanceTimersByTime(30 * MIN);
    expect(alCerrar).toHaveBeenCalledTimes(1);
  });

  it('detener cancela todo', () => {
    const { reloj, alAvisar, alReanudar, alCerrar } = montar();
    vi.advanceTimersByTime(10 * MIN);
    reloj.detener();
    vi.advanceTimersByTime(60 * MIN);
    expect(alAvisar).not.toHaveBeenCalled();
    expect(alReanudar).not.toHaveBeenCalled();
    expect(alCerrar).not.toHaveBeenCalled();
  });
});
