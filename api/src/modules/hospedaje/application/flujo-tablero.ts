import { EMPTY, endWith, interval, map, merge, Observable, startWith, takeUntil, takeWhile, timer } from 'rxjs';
import { AvisoTablero, MotivoAviso } from '../domain/aviso-tablero';

/** Intervalo del latido: mantiene viva la conexión ante proxies que cortan flujos inactivos. */
export const LATIDO_MS = 25_000;

export interface EventoFlujo {
  type: 'tablero' | 'latido';
  data: { motivo: MotivoAviso } | '';
}

const LATIDO: EventoFlujo = { type: 'latido', data: '' };
const FIN = Symbol('fin');

/**
 * Flujo que recibe un navegador: un `latido` al abrir y cada LATIDO_MS, cada aviso como evento `tablero`, y fin
 * cuando vence el token con el que se abrió (S-05 D5) o cuando el notificador se cierra (apagado de la API).
 *
 * El latido inicial no es cosmético: Nest 11 retiene las cabeceras SSE hasta el primer mensaje, y sin él el
 * navegador no sabría que el flujo está abierto hasta el primer latido periódico.
 */
export function flujoTablero(avisos: Observable<AvisoTablero>, msHastaVencer: number): Observable<EventoFlujo> {
  if (msHastaVencer <= 0) return EMPTY;
  return merge(
    avisos.pipe(
      map((a): EventoFlujo => ({ type: 'tablero', data: { motivo: a.motivo } })),
      endWith(FIN),
    ),
    interval(LATIDO_MS).pipe(map(() => LATIDO)),
  ).pipe(
    takeWhile((e): e is EventoFlujo => e !== FIN),
    startWith(LATIDO),
    takeUntil(timer(msHastaVencer)),
  );
}
