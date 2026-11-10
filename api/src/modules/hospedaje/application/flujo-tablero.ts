import { EMPTY, interval, map, merge, Observable, takeUntil, timer } from 'rxjs';
import { AvisoTablero, MotivoAviso } from '../domain/aviso-tablero';

/** Intervalo del latido: mantiene viva la conexión ante proxies que cortan flujos inactivos. */
export const LATIDO_MS = 25_000;

export interface EventoFlujo {
  type: 'tablero' | 'latido';
  data: { motivo: MotivoAviso } | '';
}

/**
 * Flujo que recibe un navegador: cada aviso como evento `tablero`, un `latido` cada LATIDO_MS, y fin cuando
 * vence el token con el que se abrió (S-05 D5), de modo que una sesión revocada no siga recibiendo avisos.
 */
export function flujoTablero(avisos: Observable<AvisoTablero>, msHastaVencer: number): Observable<EventoFlujo> {
  if (msHastaVencer <= 0) return EMPTY;
  return merge(
    avisos.pipe(map((a): EventoFlujo => ({ type: 'tablero', data: { motivo: a.motivo } }))),
    interval(LATIDO_MS).pipe(map((): EventoFlujo => ({ type: 'latido', data: '' }))),
  ).pipe(takeUntil(timer(msHastaVencer)));
}
