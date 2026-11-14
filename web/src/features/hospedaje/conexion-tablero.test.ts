import { beforeEach, describe, expect, it } from 'vitest';
import { crearConexionTablero, crearControlVisibilidad, ESPERA_OCULTA_MS, esperaReconexion, type EstadoConexion, type ManejadoresFlujo } from './conexion-tablero';

/** Deja correr las promesas pendientes (la revalidación es asíncrona). */
const asentar = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('esperaReconexion', () => {
  it('1, 2, 4, 8, 16 y 30 s como tope', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 50].map(esperaReconexion)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
});

describe('crearConexionTablero', () => {
  let estados: EstadoConexion[];
  let flujos: Array<{ m: ManejadoresFlujo; cerrado: boolean }>;
  let cambios: number;
  let programados: Array<{ fn: () => void; ms: number; cancelado: boolean }>;
  let revalidaciones: Array<(seguir: boolean) => void>;
  let conexion: ReturnType<typeof crearConexionTablero>;

  const ultimo = () => flujos[flujos.length - 1];
  const abiertos = () => flujos.filter((f) => !f.cerrado).length;
  const pendientes = () => programados.filter((p) => !p.cancelado);
  /** Falla el flujo actual, resuelve la revalidación y devuelve la espera programada. */
  const fallarYRevalidar = async (seguir = true) => {
    ultimo().m.alFallar();
    revalidaciones.shift()!(seguir);
    await asentar();
    return programados[programados.length - 1];
  };

  beforeEach(() => {
    estados = [];
    flujos = [];
    cambios = 0;
    programados = [];
    revalidaciones = [];
    conexion = crearConexionTablero({
      abrir: (m) => {
        const f = { m, cerrado: false };
        flujos.push(f);
        return () => {
          f.cerrado = true;
        };
      },
      alCambiar: () => {
        cambios++;
      },
      revalidar: () => new Promise<boolean>((r) => revalidaciones.push(r)),
      alEstado: (e) => estados.push(e),
      programar: (fn, ms) => {
        const p = { fn, ms, cancelado: false };
        programados.push(p);
        return () => {
          p.cancelado = true;
        };
      },
    });
  });

  it('al iniciar queda conectando y abre un flujo; iniciar dos veces abre uno solo', () => {
    conexion.iniciar();
    conexion.iniciar();
    expect(estados).toEqual(['conectando']);
    expect(flujos).toHaveLength(1);
  });

  it('al abrir pasa a en-vivo y pide el tablero', () => {
    conexion.iniciar();
    ultimo().m.alAbrir();
    expect(estados).toEqual(['conectando', 'en-vivo']);
    expect(cambios).toBe(1);
  });

  it('cada aviso pide el tablero', () => {
    conexion.iniciar();
    ultimo().m.alAbrir();
    ultimo().m.alAviso();
    ultimo().m.alAviso();
    expect(cambios).toBe(3);
  });

  it('al fallar cierra, pasa a reconectando, revalida y reabre tras 1 s', async () => {
    conexion.iniciar();
    ultimo().m.alAbrir();
    ultimo().m.alFallar();
    expect(flujos[0].cerrado).toBe(true);
    expect(estados).toEqual(['conectando', 'en-vivo', 'reconectando']);
    expect(revalidaciones).toHaveLength(1);
    expect(programados).toHaveLength(0);

    revalidaciones.shift()!(true);
    await asentar();
    expect(programados.map((p) => p.ms)).toEqual([1000]);

    programados[0].fn();
    expect(flujos).toHaveLength(2);
    expect(abiertos()).toBe(1);
  });

  it('fallos seguidos esperan 1, 2, 4, 8, 16, 30, 30 s', async () => {
    conexion.iniciar();
    for (let i = 0; i < 7; i++) (await fallarYRevalidar()).fn();
    expect(programados.map((p) => p.ms)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('tras una apertura correcta la espera vuelve a 1 s', async () => {
    conexion.iniciar();
    (await fallarYRevalidar()).fn();
    (await fallarYRevalidar()).fn();
    ultimo().m.alAbrir();
    expect((await fallarYRevalidar()).ms).toBe(1000);
  });

  it('si la sesión terminó no reabre', async () => {
    conexion.iniciar();
    await fallarYRevalidar(false);
    expect(programados).toHaveLength(0);
    expect(abiertos()).toBe(0);
  });

  it('tras terminar la sesión, iniciar vuelve a conectar', async () => {
    conexion.iniciar();
    await fallarYRevalidar(false);
    conexion.iniciar();
    expect(abiertos()).toBe(1);
  });

  it('detener cierra el flujo y cancela la reconexión programada', async () => {
    conexion.iniciar();
    await fallarYRevalidar();
    conexion.detener();
    expect(pendientes()).toHaveLength(0);

    conexion.iniciar();
    conexion.detener();
    expect(abiertos()).toBe(0);
  });

  it('detener mientras se revalida: al resolver no reabre ni cambia el estado', async () => {
    conexion.iniciar();
    ultimo().m.alFallar();
    conexion.detener();
    const antes = [...estados];
    revalidaciones.shift()!(true);
    await asentar();
    expect(programados).toHaveLength(0);
    expect(flujos).toHaveLength(1);
    expect(estados).toEqual(antes);
  });

  it('los manejadores de un flujo detenido se ignoran', () => {
    conexion.iniciar();
    const viejo = ultimo().m;
    conexion.detener();
    const antes = [...estados];
    viejo.alAbrir();
    viejo.alAviso();
    viejo.alFallar();
    expect(estados).toEqual(antes);
    expect(cambios).toBe(0);
    expect(revalidaciones).toHaveLength(0);
  });

  it('iniciar tras detener, con el primer intento fallido, se recupera', async () => {
    conexion.iniciar();
    ultimo().m.alAbrir();
    conexion.detener();

    conexion.iniciar();
    const espera = await fallarYRevalidar();
    expect(espera.ms).toBe(1000);
    espera.fn();
    ultimo().m.alAbrir();
    expect(estados[estados.length - 1]).toBe('en-vivo');
    expect(abiertos()).toBe(1);
  });

  it('un segundo fallo del mismo flujo no programa otra reconexión', async () => {
    conexion.iniciar();
    const m = ultimo().m;
    m.alFallar();
    m.alFallar();
    expect(revalidaciones).toHaveLength(1);
    revalidaciones.shift()!(true);
    await asentar();
    expect(programados).toHaveLength(1);
  });

  describe('estado de los avisos (Redis)', () => {
    it('sin avisos pasa a respaldo; al volver, a en-vivo y recarga lo que se perdió', () => {
      conexion.iniciar();
      ultimo().m.alAbrir();
      ultimo().m.alServicio(false);
      expect(estados).toEqual(['conectando', 'en-vivo', 'respaldo']);
      const antes = cambios;
      ultimo().m.alServicio(true);
      expect(estados[estados.length - 1]).toBe('en-vivo');
      expect(cambios).toBe(antes + 1);
    });

    it('confirmar que los avisos funcionan no recarga ni repite el estado', () => {
      conexion.iniciar();
      ultimo().m.alAbrir();
      const antes = cambios;
      ultimo().m.alServicio(true);
      expect(estados).toEqual(['conectando', 'en-vivo']);
      expect(cambios).toBe(antes);
    });

    it('una conexión nueva parte confiando en los avisos hasta que el servidor diga lo contrario', async () => {
      conexion.iniciar();
      ultimo().m.alAbrir();
      ultimo().m.alServicio(false);
      (await fallarYRevalidar()).fn();
      ultimo().m.alAbrir();
      expect(estados[estados.length - 1]).toBe('en-vivo');
    });

    it('se ignora el estado de un flujo detenido', () => {
      conexion.iniciar();
      const viejo = ultimo().m;
      viejo.alAbrir();
      conexion.detener();
      const antes = [...estados];
      viejo.alServicio(false);
      expect(estados).toEqual(antes);
    });
  });
});

describe('crearControlVisibilidad', () => {
  let llamadas: string[];
  let programados: Array<{ fn: () => void; ms: number; cancelado: boolean }>;
  let control: ReturnType<typeof crearControlVisibilidad>;

  beforeEach(() => {
    llamadas = [];
    programados = [];
    control = crearControlVisibilidad(
      { iniciar: () => llamadas.push('iniciar'), detener: () => llamadas.push('detener') },
      (fn, ms) => {
        const p = { fn, ms, cancelado: false };
        programados.push(p);
        return () => {
          p.cancelado = true;
        };
      },
    );
  });

  it(`al ocultarse no corta de inmediato: espera ${ESPERA_OCULTA_MS / 1000} s`, () => {
    control.visible();
    control.oculta();
    expect(llamadas).toEqual(['iniciar']);
    expect(programados.map((p) => p.ms)).toEqual([ESPERA_OCULTA_MS]);
    programados[0].fn();
    expect(llamadas).toEqual(['iniciar', 'detener']);
  });

  it('si vuelve a verse antes del plazo, sigue conectada', () => {
    control.visible();
    control.oculta();
    control.visible();
    expect(programados[0].cancelado).toBe(true);
    expect(llamadas).toEqual(['iniciar', 'iniciar']);
  });

  it('parpadeos seguidos no acumulan esperas', () => {
    control.visible();
    control.oculta();
    control.oculta();
    expect(programados.filter((p) => !p.cancelado)).toHaveLength(1);
  });

  it('liberar corta ya y cancela la espera pendiente', () => {
    control.visible();
    control.oculta();
    control.liberar();
    expect(programados[0].cancelado).toBe(true);
    expect(llamadas).toEqual(['iniciar', 'detener']);
  });
});
