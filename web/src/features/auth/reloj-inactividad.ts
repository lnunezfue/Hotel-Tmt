export interface OpcionesReloj {
  limiteMs: number;
  avisoMs: number;
  alAvisar: (cierreEn: number) => void;
  alReanudar: () => void;
  alCerrar: () => void;
  ahora?: () => number;
}

/** Cuenta la inactividad: avisa `avisoMs` antes del límite y cierra al alcanzarlo. */
export function crearRelojInactividad(o: OpcionesReloj): { registrarActividad(): void; detener(): void } {
  const ahora = o.ahora ?? Date.now;
  let tAviso: ReturnType<typeof setTimeout> | undefined;
  let tCierre: ReturnType<typeof setTimeout> | undefined;
  let avisando = false;
  let detenido = false;

  const limpiar = () => {
    clearTimeout(tAviso);
    clearTimeout(tCierre);
  };

  const armar = () => {
    limpiar();
    const cierreEn = ahora() + o.limiteMs;
    tAviso = setTimeout(() => {
      avisando = true;
      o.alAvisar(cierreEn);
    }, Math.max(0, o.limiteMs - o.avisoMs));
    tCierre = setTimeout(() => {
      avisando = false;
      o.alCerrar();
    }, o.limiteMs);
  };

  armar();

  return {
    registrarActividad() {
      if (detenido) return;
      if (avisando) {
        avisando = false;
        o.alReanudar();
      }
      armar();
    },
    detener() {
      detenido = true;
      limpiar();
    },
  };
}
