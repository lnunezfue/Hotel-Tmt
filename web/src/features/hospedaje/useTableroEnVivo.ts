import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Tablero } from '../../lib/api';
import { useSesion } from '../auth/sesion';
import { crearConexionTablero, crearControlVisibilidad, type EstadoConexion } from './conexion-tablero';

/**
 * Mantiene el tablero al día con los avisos del servidor (S-05). El flujo se corta tras 15 s con la pestaña oculta:
 * el navegador limita las conexiones por origen y varias pestañas con flujo abierto bloquearían el resto (D7).
 */
export function useTableroEnVivo(): EstadoConexion {
  const qc = useQueryClient();
  const { data: sesion } = useSesion();
  const sucursalId = sesion?.sucursalId;
  const [estado, setEstado] = useState<EstadoConexion>('conectando');

  useEffect(() => {
    if (sucursalId === undefined) return;

    const conexion = crearConexionTablero({
      abrir: (m) => {
        const es = new EventSource('/api/hospedaje/tablero/eventos', { withCredentials: true });
        es.onopen = () => m.alAbrir();
        es.onerror = () => m.alFallar();
        es.addEventListener('tablero', () => m.alAviso());
        es.addEventListener('servicio', (e) => {
          try {
            m.alServicio((JSON.parse((e as MessageEvent<string>).data) as { avisos?: unknown }).avisos !== false);
          } catch {
            // un evento mal formado no cambia el estado
          }
        });
        return () => es.close();
      },
      alCambiar: () => {
        void qc.invalidateQueries({ queryKey: ['tablero'] });
        void qc.invalidateQueries({ queryKey: ['historial'] });
      },
      // Por `api()` y no por el flujo: es la vía que renueva el acceso vencido y detecta la sesión terminada.
      revalidar: async () => {
        try {
          qc.setQueryData(['tablero'], await api<Tablero>('/hospedaje/tablero'));
          return true;
        } catch (e) {
          return !(e instanceof ApiError && e.status === 401);
        }
      },
      alEstado: setEstado,
      programar: (fn, ms) => {
        const id = window.setTimeout(fn, ms);
        return () => window.clearTimeout(id);
      },
    });

    const visibilidad = crearControlVisibilidad(conexion, (fn, ms) => {
      const id = window.setTimeout(fn, ms);
      return () => window.clearTimeout(id);
    });
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'visible') visibilidad.visible();
      else visibilidad.oculta();
    };
    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    if (document.visibilityState === 'visible') visibilidad.visible();

    return () => {
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      visibilidad.liberar();
    };
  }, [qc, sucursalId]);

  return estado;
}
