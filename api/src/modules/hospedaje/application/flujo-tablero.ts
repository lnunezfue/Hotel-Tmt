import { distinctUntilChanged, EMPTY, endWith, interval, map, merge, Observable, startWith, takeUntil, takeWhile, timer } from 'rxjs';
import { AvisoTablero, MotivoAviso } from '../domain/aviso-tablero';

/** Intervalo del latido: mantiene viva la conexión ante proxies que cortan flujos inactivos. */
export const LATIDO_MS = 25_000;

export type EventoFlujo =
  | { type: 'latido'; data: '' }
  | { type: 'tablero'; data: { motivo: MotivoAviso } }
  /** Si los avisos están llegando (Redis disponible). Sin ellos, el tablero solo se actualiza con su consulta de respaldo. */
  | { type: 'servicio'; data: { avisos: boolean } };

const LATIDO: EventoFlujo = { type: 'latido', data: '' };
const FIN = Symbol('fin');

/**
 * Flujo que recibe un navegador: un `latido` al abrir y cada LATIDO_MS, cada aviso como evento `tablero`, el estado
 * de los avisos como evento `servicio` (al abrir, si `disponible` ya tiene valor, y en cada cambio), y fin cuando vence
 * el token con el que se abrió (S-05 D5) o cuando el notificador se cierra (apagado de la API).
 *
 * El latido inicial es un resguardo: garantiza un primer byte aunque un proxy o una versión de Nest retengan las
 * cabeceras hasta el primer mensaje.
 */
export function flujoTablero(avisos: Observable<AvisoTablero>, msHastaVencer: number, disponible: Observable<boolean>): Observable<EventoFlujo> {
  if (msHastaVencer <= 0) return EMPTY;
  return merge(
    avisos.pipe(
      map((a): EventoFlujo => ({ type: 'tablero', data: { motivo: a.motivo } })),
      endWith(FIN),
    ),
    disponible.pipe(
      distinctUntilChanged(),
      map((avisosDisponibles): EventoFlujo => ({ type: 'servicio', data: { avisos: avisosDisponibles } })),
    ),
    interval(LATIDO_MS).pipe(map(() => LATIDO)),
  ).pipe(
    takeWhile((e): e is EventoFlujo => e !== FIN),
    startWith(LATIDO),
    takeUntil(timer(msHastaVencer)),
  );
}
