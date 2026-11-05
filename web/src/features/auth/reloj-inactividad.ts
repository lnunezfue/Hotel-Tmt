export interface OpcionesReloj {
  limiteMs: number;
  avisoMs: number;
  alAvisar: (cierreEn: number) => void;
  alReanudar: () => void;
  alCerrar: () => void;
  ahora?: () => number;
}

/**
 * Cuenta la inactividad contra un plazo absoluto (`ahora()`), no contra temporizadores
 * relativos: así una pestaña en segundo plano o un equipo dormido cierran al despertar.
 */
export function crearRelojInactividad(o: OpcionesReloj): { registrarActividad(): void; revisar(): void; detener(): void } {
  const ahora = o.ahora ?? Date.now;
  let ultimaActividad = ahora();
  let avisando = false;
  let terminado = false;

  const revisar = () => {
    if (terminado) return;
    const transcurrido = ahora() - ultimaActividad;
    if (transcurrido >= o.limiteMs) {
      terminado = true;
      avisando = false;
      clearInterval(tic);
      o.alCerrar();
    } else if (!avisando && transcurrido >= o.limiteMs - o.avisoMs) {
      avisando = true;
      o.alAvisar(ultimaActividad + o.limiteMs);
    }
  };

  const tic = setInterval(revisar, 1000);

  return {
    registrarActividad() {
      if (terminado) return;
      // Si el plazo ya venció (p. ej. al despertar), cierra en vez de reanudar.
      if (ahora() - ultimaActividad >= o.limiteMs) {
        revisar();
        return;
      }
      ultimaActividad = ahora();
      if (avisando) {
        avisando = false;
        o.alReanudar();
      }
    },
    revisar,
    detener() {
      terminado = true;
      clearInterval(tic);
    },
  };
}
