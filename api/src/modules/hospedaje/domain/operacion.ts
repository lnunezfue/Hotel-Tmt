/**
 * Operación de la sucursal (spec 2026-11-26 operación real): hora máxima de salida según la hora del check-in, salida de la noche,
 * cobro al ingreso y tiempo de limpieza. Lógica pura; las horas son de Lima (UTC−5 todo el año).
 */
export class ReglaOperacionError extends Error {}

const ZONA_LIMA_MIN = -5 * 60;
const MIN_DIA = 24 * 60;
/** Una noche vendida en la madrugada sale ese mismo día solo si quedan al menos estas horas hasta la salida. */
export const MIN_HORAS_NOCHE = 3;

export interface Franja {
  nombre: string;
  /** HH:MM, incluida */
  desde: string;
  /** HH:MM, excluida; 00:00 = medianoche */
  hasta: string;
  /** HH:MM */
  salidaMaxima: string;
  /** 0 = el mismo día del check-in, 1 = el día siguiente */
  diasDespues: number;
}

export interface Operacion {
  cobroAlIngreso: boolean;
  vendeConsumos: boolean;
  minutosLimpieza: number;
  /** Salida de la noche o turno completo (turno de 24 h). null = la regla de siempre (12:00 tras la última noche). */
  horaSalidaNoche: string | null;
  turnoSugeridoId: number | null;
  franjas: Franja[];
}

/** Sin configuración la sucursal trabaja como hasta S-07: cobra al salir, vende consumos y no tiene topes. */
export const OPERACION_POR_DEFECTO: Operacion = {
  cobroAlIngreso: false,
  vendeConsumos: true,
  minutosLimpieza: 30,
  horaSalidaNoche: null,
  turnoSugeridoId: null,
  franjas: [],
};

/** Las del hotel de parejas (información del cuartelero, 2026-11-26). */
export const FRANJAS_SUGERIDAS: Franja[] = [
  { nombre: 'Madrugada', desde: '00:00', hasta: '06:00', salidaMaxima: '12:00', diasDespues: 0 },
  { nombre: 'Mañana', desde: '06:00', hasta: '12:00', salidaMaxima: '18:00', diasDespues: 0 },
  { nombre: 'Tarde y noche', desde: '12:00', hasta: '00:00', salidaMaxima: '06:00', diasDespues: 1 },
];

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutosDe(hora: string): number {
  const m = HORA.exec(hora);
  if (!m) throw new ReglaOperacionError(`Hora no válida: «${hora}»; usa HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function horaDe(minutos: number): string {
  const m = ((minutos % MIN_DIA) + MIN_DIA) % MIN_DIA;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Minuto del día en Lima y medianoche de Lima (como instante UTC) del día del instante. */
function enLima(instante: Date): { minuto: number; medianoche: number } {
  const local = instante.getTime() + ZONA_LIMA_MIN * 60_000;
  const minuto = Math.floor((((local / 60_000) % MIN_DIA) + MIN_DIA) % MIN_DIA);
  const medianoche = instante.getTime() - minuto * 60_000 - (instante.getTime() % 60_000);
  return { minuto, medianoche };
}

const fin = (f: Franja) => (minutosDe(f.hasta) === 0 ? MIN_DIA : minutosDe(f.hasta));

/** Franjas ordenadas, sin cruces y con una salida posterior al final de la franja (si no, no queda tiempo). */
export function validarFranjas(franjas: Franja[]): Franja[] {
  if (franjas.length > 8) throw new ReglaOperacionError('Se admiten hasta 8 franjas');
  const limpias = franjas.map((f) => {
    const nombre = f.nombre.trim().replace(/\s+/g, ' ');
    if (nombre.length < 2 || nombre.length > 30) throw new ReglaOperacionError('El nombre de la franja debe tener entre 2 y 30 caracteres');
    if (f.diasDespues !== 0 && f.diasDespues !== 1) throw new ReglaOperacionError('La salida es el mismo día o el día siguiente');
    const desde = minutosDe(f.desde);
    const hasta = fin(f);
    if (hasta <= desde) throw new ReglaOperacionError(`La franja «${nombre}» termina antes de empezar`);
    if (minutosDe(f.salidaMaxima) + f.diasDespues * MIN_DIA < hasta) {
      throw new ReglaOperacionError(`En la franja «${nombre}» la salida máxima (${f.salidaMaxima}) llega antes de que termine la franja (${f.hasta})`);
    }
    return { ...f, nombre };
  });
  limpias.sort((a, b) => minutosDe(a.desde) - minutosDe(b.desde));
  for (let i = 1; i < limpias.length; i++) {
    if (minutosDe(limpias[i].desde) < fin(limpias[i - 1])) throw new ReglaOperacionError(`Las franjas «${limpias[i - 1].nombre}» y «${limpias[i].nombre}» se cruzan`);
  }
  return limpias;
}

export function franjaDe(checkin: Date, franjas: Franja[]): Franja | null {
  const { minuto } = enLima(checkin);
  return franjas.find((f) => minutosDe(f.desde) <= minuto && minuto < fin(f)) ?? null;
}

/** Hora máxima de salida para un check-in en esa franja. */
export function salidaMaxima(checkin: Date, f: Franja): Date {
  const { medianoche } = enLima(checkin);
  return new Date(medianoche + (f.diasDespues * MIN_DIA + minutosDe(f.salidaMaxima)) * 60_000);
}

const formatoSalida = (checkin: Date, salida: Date) => {
  const dias = Math.round((enLima(salida).medianoche - enLima(checkin).medianoche) / (MIN_DIA * 60_000));
  return `${horaDe(enLima(salida).minuto)}${dias === 1 ? ' del día siguiente' : dias > 1 ? ` (+${dias} días)` : ''}`;
};

/**
 * Salida de una estadía por horas: el check-in más las horas compradas, sin pasar la hora máxima de la franja.
 * Si la pasa, se rechaza con lo que sí cabe (vender horas que no se pueden usar sería cobrar de más).
 */
export function salidaPorHoras(checkin: Date, horasTurno: number, turnos: number, franjas: Franja[]): { salida: Date; maxima: Date | null } {
  const salida = new Date(checkin.getTime() + horasTurno * turnos * 3_600_000);
  const f = franjaDe(checkin, franjas);
  if (!f) return { salida, maxima: null };
  const maxima = salidaMaxima(checkin, f);
  if (salida > maxima) {
    const caben = Math.floor((maxima.getTime() - checkin.getTime()) / (horasTurno * 3_600_000));
    throw new ReglaOperacionError(
      `Con ingreso en la franja «${f.nombre}» la salida máxima es a las ${formatoSalida(checkin, maxima)}. ` +
        (caben > 0 ? `Caben ${caben} ${caben === 1 ? 'turno' : 'turnos'} de ${horasTurno} h, o vende la noche completa.` : `No cabe un turno de ${horasTurno} h; elige uno más corto o la noche completa.`),
    );
  }
  return { salida, maxima };
}

/**
 * Salida de la noche o turno completo: a la hora de salida de la noche del día siguiente. Un ingreso de madrugada
 * con al menos MIN_HORAS_NOCHE por delante sale ese mismo día (quien entra a las 2:00 sale a las 9:00, no al otro día).
 */
export function salidaNoche(checkin: Date, horaSalida: string, noches: number): Date {
  if (!Number.isInteger(noches) || noches < 1 || noches > 60) throw new ReglaOperacionError('Las noches deben ser de 1 a 60');
  const { minuto, medianoche } = enLima(checkin);
  const salidaMin = minutosDe(horaSalida);
  const mismoDia = minuto <= salidaMin - MIN_HORAS_NOCHE * 60;
  return new Date(medianoche + ((mismoDia ? 0 : 1) + noches - 1) * MIN_DIA * 60_000 + salidaMin * 60_000);
}

/** Habitación en limpieza: minutos que lleva y si ya pasó el tiempo esperado. */
export function estadoLimpieza(desde: Date, ahora: Date, minutosEsperados: number): { minutos: number; demorada: boolean } {
  const minutos = Math.max(0, Math.floor((ahora.getTime() - desde.getTime()) / 60_000));
  return { minutos, demorada: minutos > minutosEsperados };
}

export function validarMinutosLimpieza(m: number): void {
  if (!Number.isInteger(m) || m < 5 || m > 240) throw new ReglaOperacionError('El tiempo de limpieza debe ser de 5 a 240 minutos');
}
