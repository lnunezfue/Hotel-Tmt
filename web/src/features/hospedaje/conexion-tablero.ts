/**
 * Conexión en vivo del tablero (S-05 §5.1), sin navegador ni React: el flujo, el temporizador y la revalidación
 * se inyectan, de modo que la reconexión se prueba como lógica pura. `useTableroEnVivo` la conecta con EventSource.
 */
/** `respaldo`: conectado, pero el servidor no está recibiendo avisos (Redis caído); solo actualiza la consulta de cada minuto. */
export type EstadoConexion = 'conectando' | 'en-vivo' | 'respaldo' | 'reconectando';

export const ESPERAS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

/** Espera antes del reintento número `intento` (desde 0): 1, 2, 4, 8, 16 y 30 s como tope. */
export function esperaReconexion(intento: number): number {
  return ESPERAS_MS[Math.min(Math.max(intento, 0), ESPERAS_MS.length - 1)];
}

export interface ManejadoresFlujo {
  alAbrir(): void;
  alAviso(): void;
  alFallar(): void;
  /** El servidor informa si los avisos le están llegando. */
  alServicio(avisos: boolean): void;
}

export interface DepsConexion {
  /** Abre el flujo y devuelve cómo cerrarlo. */
  abrir(m: ManejadoresFlujo): () => void;
  /** Hay que volver a pedir el tablero (y el historial visible). */
  alCambiar(): void;
  /** Pide el tablero por la vía normal, que renueva la sesión si hace falta. `false` = la sesión terminó. Nunca rechaza. */
  revalidar(): Promise<boolean>;
  alEstado(e: EstadoConexion): void;
  /** Temporizador inyectable; devuelve cómo cancelarlo. */
  programar(fn: () => void, ms: number): () => void;
}

export function crearConexionTablero(d: DepsConexion): { iniciar(): void; detener(): void } {
  let activa = false;
  /** Cambia en cada iniciar/detener: lo que resuelva de una generación anterior se ignora. */
  let generacion = 0;
  let intento = 0;
  let cerrar: (() => void) | null = null;
  let cancelar: (() => void) | null = null;

  function abrir(g: number): void {
    cancelar = null;
    let fallado = false;
    /** Cada conexión parte confiando en los avisos; el servidor lo corrige con su primer evento `servicio`. */
    let avisos = true;
    const vigente = () => g === generacion && !fallado;
    cerrar = d.abrir({
      alAbrir: () => {
        if (!vigente()) return;
        intento = 0;
        d.alEstado('en-vivo');
        d.alCambiar();
      },
      alAviso: () => {
        if (vigente()) d.alCambiar();
      },
      alServicio: (ahora) => {
        if (!vigente() || ahora === avisos) return;
        avisos = ahora;
        d.alEstado(ahora ? 'en-vivo' : 'respaldo');
        if (ahora) d.alCambiar(); // los avisos perdidos mientras no había Redis: se recupera todo de una vez
      },
      alFallar: () => {
        if (!vigente()) return;
        fallado = true;
        cerrar?.();
        cerrar = null;
        d.alEstado('reconectando');
        void d.revalidar().then((seguir) => {
          if (g !== generacion) return;
          if (!seguir) {
            activa = false;
            generacion++;
            return;
          }
          cancelar = d.programar(() => abrir(g), esperaReconexion(intento++));
        });
      },
    });
  }

  return {
    iniciar() {
      if (activa) return;
      activa = true;
      generacion++;
      intento = 0;
      d.alEstado('conectando');
      abrir(generacion);
    },
    detener() {
      activa = false;
      generacion++;
      cerrar?.();
      cerrar = null;
      cancelar?.();
      cancelar = null;
    },
  };
}

/** Cuánto puede estar oculta la pestaña antes de cortar la conexión en vivo. */
export const ESPERA_OCULTA_MS = 15_000;

/**
 * Corta la conexión cuando la pestaña lleva ESPERA_OCULTA_MS oculta, no al instante: así un cambio rápido de ventana,
 * o un visor que alterna visible/oculto, no provoca una reconexión cada vez (S-05 D7 sigue cumpliéndose: una
 * pestaña olvidada libera su conexión).
 */
export function crearControlVisibilidad(
  c: { iniciar(): void; detener(): void },
  programar: (fn: () => void, ms: number) => () => void,
): { visible(): void; oculta(): void; liberar(): void } {
  let cancelar: (() => void) | null = null;
  const cancelarPendiente = () => {
    cancelar?.();
    cancelar = null;
  };
  return {
    visible() {
      cancelarPendiente();
      c.iniciar();
    },
    oculta() {
      if (cancelar) return;
      cancelar = programar(() => {
        cancelar = null;
        c.detener();
      }, ESPERA_OCULTA_MS);
    },
    liberar() {
      cancelarPendiente();
      c.detener();
    },
  };
}
