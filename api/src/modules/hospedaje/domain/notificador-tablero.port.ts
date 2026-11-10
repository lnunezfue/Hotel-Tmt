import type { Observable } from 'rxjs';
import type { AvisoTablero } from './aviso-tablero';

export const NOTIFICADOR_TABLERO = Symbol('NotificadorTablero');

/** Puerto del reparto de avisos del tablero. El adaptador real usa Redis pub/sub. */
export interface NotificadorTablero {
  /** Puede rechazar (p. ej. Redis caído); quien publica decide qué hacer con el fallo. */
  publicar(aviso: AvisoTablero): Promise<void>;
  /** Avisos de una sucursal, publicados desde cualquier réplica. */
  escuchar(sucursalId: number): Observable<AvisoTablero>;
}
