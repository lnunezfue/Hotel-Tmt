import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { crearRelojInactividad } from './reloj-inactividad';

const EVENTOS = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;
const AVISO_MS = 60_000;
const CANAL = 'hotel-actividad';

function irAlLogin() {
  location.replace('/login?motivo=INACTIVIDAD');
}

export function useInactividad(minutos: number | undefined): { cierreEn: number | null; seguir: () => void } {
  const [cierreEn, setCierreEn] = useState<number | null>(null);
  const actividad = useRef<() => void>(() => {});

  useEffect(() => {
    if (minutos === undefined) return;
    const limiteMs = minutos * 60_000;
    let canal: BroadcastChannel | null = null;
    try {
      canal = new BroadcastChannel(CANAL);
    } catch {
      canal = null;
    }
    const avisar = (tipo: 'actividad' | 'cierre') => {
      try {
        canal?.postMessage({ tipo });
      } catch {
        /* sin canal: cada pestaña cuenta por su cuenta */
      }
    };

    const reloj = crearRelojInactividad({
      limiteMs,
      avisoMs: Math.min(AVISO_MS, limiteMs),
      alAvisar: setCierreEn,
      alReanudar: () => setCierreEn(null),
      alCerrar: () => {
        const logout = api('/auth/logout', { method: 'POST', body: JSON.stringify({ motivo: 'INACTIVIDAD' }) }).catch(() => undefined);
        const espera = new Promise<void>((r) => setTimeout(r, 3000));
        void Promise.race([logout, espera]).finally(() => {
          avisar('cierre');
          irAlLogin();
        });
      },
    });

    let ultimo = 0;
    const local = () => {
      const t = Date.now();
      if (t - ultimo < 1000) return;
      ultimo = t;
      reloj.registrarActividad();
      avisar('actividad');
    };
    actividad.current = () => {
      ultimo = Date.now();
      reloj.registrarActividad();
      avisar('actividad');
    };

    const alVolver = () => {
      if (document.visibilityState === 'visible') reloj.revisar();
    };
    document.addEventListener('visibilitychange', alVolver);
    for (const e of EVENTOS) window.addEventListener(e, local, { passive: true });
    if (canal) {
      canal.onmessage = (m: MessageEvent<{ tipo?: string }>) => {
        if (m.data?.tipo === 'actividad') reloj.registrarActividad();
        else if (m.data?.tipo === 'cierre') irAlLogin();
      };
    }

    return () => {
      for (const e of EVENTOS) window.removeEventListener(e, local);
      document.removeEventListener('visibilitychange', alVolver);
      reloj.detener();
      try {
        canal?.close();
      } catch {
        /* nada */
      }
      actividad.current = () => {};
      setCierreEn(null);
    };
  }, [minutos]);

  const seguir = useCallback(() => actividad.current(), []);
  return { cierreEn, seguir };
}
