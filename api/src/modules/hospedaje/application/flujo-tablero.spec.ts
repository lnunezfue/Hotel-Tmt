import { Subject, Subscription } from 'rxjs';
import { AvisoTablero } from '../domain/aviso-tablero';
import { EventoFlujo, flujoTablero } from './flujo-tablero';

describe('flujoTablero', () => {
  let avisos: Subject<AvisoTablero>;
  let recibidos: EventoFlujo[];
  let terminado: boolean;
  let suscripcion: Subscription;

  const abrir = (msHastaVencer: number) => {
    suscripcion = flujoTablero(avisos, msHastaVencer).subscribe({
      next: (e) => recibidos.push(e),
      complete: () => {
        terminado = true;
      },
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    avisos = new Subject();
    recibidos = [];
    terminado = false;
  });

  afterEach(() => {
    suscripcion?.unsubscribe();
    jest.useRealTimers();
  });

  it('emite un latido al abrir, para que las cabeceras salgan de inmediato', () => {
    abrir(900_000);
    expect(recibidos).toEqual([{ type: 'latido', data: '' }]);
  });

  it('convierte cada aviso en un evento tablero con su motivo', () => {
    abrir(900_000);
    avisos.next({ sucursalId: 1, motivo: 'estado' });
    expect(recibidos).toEqual([{ type: 'latido', data: '' }, { type: 'tablero', data: { motivo: 'estado' } }]);
  });

  it('emite un latido cada 25 s', () => {
    abrir(900_000);
    jest.advanceTimersByTime(50_000);
    expect(recibidos).toEqual([{ type: 'latido', data: '' }, { type: 'latido', data: '' }, { type: 'latido', data: '' }]);
  });

  it('termina cuando el notificador deja de emitir (cierre de la API)', () => {
    abrir(900_000);
    avisos.complete();
    expect(terminado).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('termina al vencer el token y deja de escuchar los avisos', () => {
    abrir(60_000);
    jest.advanceTimersByTime(59_999);
    expect(terminado).toBe(false);
    jest.advanceTimersByTime(1);
    expect(terminado).toBe(true);
    expect(avisos.observed).toBe(false);
  });

  it.each([0, -5])('termina de inmediato si el token ya venció (%d ms)', (ms) => {
    abrir(ms);
    expect(terminado).toBe(true);
    expect(recibidos).toEqual([]);
    expect(avisos.observed).toBe(false);
  });

  it('al cancelar la suscripción deja de escuchar y detiene el latido', () => {
    abrir(900_000);
    suscripcion.unsubscribe();
    expect(avisos.observed).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});
