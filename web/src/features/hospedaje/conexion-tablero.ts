/**
 * Conexión en vivo del tablero (S-05 §5.1), sin navegador ni React: el flujo, el temporizador y la revalidación
 * se inyectan, de modo que la reconexión se prueba como lógica pura. `useTableroEnVivo` la conecta con EventSource.
 */
export type EstadoConexion = 'conectando' | 'en-vivo' | 'reconectando';

export const ESPERAS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;

/** Espera antes del reintento número `intento` (desde 0): 1, 2, 4, 8, 16 y 30 s como tope. */
export function esperaReconexion(intento: number): number {
  return ESPERAS_MS[Math.min(Math.max(intento, 0), ESPERAS_MS.length - 1)];
}

export interface ManejadoresFlujo {
  alAbrir(): void;
  alAviso(): void;
  alFallar(): void;
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
