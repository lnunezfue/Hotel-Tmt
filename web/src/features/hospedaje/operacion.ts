import { useQuery } from '@tanstack/react-query';
import { api, type FranjaSalida, type Operacion } from '../../lib/api';

/**
 * Vista previa de la salida en el check-in (la regla de verdad está en la API: hospedaje/domain/operacion.ts).
 * Horas de Lima (UTC−5 todo el año).
 */
const MIN_DIA = 24 * 60;
const MIN_HORAS_NOCHE = 3;
/** La hora máxima se mira por minuto (los segundos del check-in no cuentan). */
export const MARGEN_MINUTO_MS = 59_999;

export const useOperacion = () => useQuery({ queryKey: ['operacion'], queryFn: () => api<Operacion>('/hospedaje/operacion'), staleTime: 60_000 });

const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const fin = (f: FranjaSalida) => (minutos(f.hasta) === 0 ? MIN_DIA : minutos(f.hasta));

function enLima(t: Date) {
  const minuto = Math.floor((((t.getTime() / 60_000 - 5 * 60) % MIN_DIA) + MIN_DIA) % MIN_DIA);
  return { minuto, medianoche: t.getTime() - minuto * 60_000 - (t.getTime() % 60_000) };
}

export function franjaDe(t: Date, franjas: FranjaSalida[]): FranjaSalida | null {
  const { minuto } = enLima(t);
  return franjas.find((f) => minutos(f.desde) <= minuto && minuto < fin(f)) ?? null;
}

export interface SalidaPrevista {
  salida: Date;
  /** Hora máxima de la franja del ingreso (por horas). */
  maxima: Date | null;
  franja: string | null;
  /** Pasa la hora máxima: la API lo rechazará. */
  excede: boolean;
  /** Turnos que sí caben antes de la hora máxima. */
  caben: number | null;
}

export function salidaPrevista(ahora: Date, horasTurno: number, cantidad: number, op: Operacion | undefined): SalidaPrevista {
  const { minuto, medianoche } = enLima(ahora);
  if (horasTurno === 24 && op?.horaSalidaNoche) {
    const s = minutos(op.horaSalidaNoche);
    const mismoDia = minuto <= s - MIN_HORAS_NOCHE * 60;
    return { salida: new Date(medianoche + ((mismoDia ? 0 : 1) + cantidad - 1) * MIN_DIA * 60_000 + s * 60_000), maxima: null, franja: null, excede: false, caben: null };
  }
  const salida = new Date(ahora.getTime() + horasTurno * cantidad * 3_600_000);
  const f = horasTurno === 24 ? null : franjaDe(ahora, op?.franjas ?? []);
  if (!f) return { salida, maxima: null, franja: null, excede: false, caben: null };
  const maxima = new Date(medianoche + (f.diasDespues * MIN_DIA + minutos(f.salidaMaxima)) * 60_000);
  return { salida, maxima, franja: f.nombre, excede: salida.getTime() > maxima.getTime() + MARGEN_MINUTO_MS, caben: Math.floor((maxima.getTime() + MARGEN_MINUTO_MS - ahora.getTime()) / (horasTurno * 3_600_000)) };
}

/** «01:15» o «09:00 de mañana». */
export function horaConDia(t: Date, desde: Date = new Date()): string {
  const dias = Math.round((enLima(t).medianoche - enLima(desde).medianoche) / (MIN_DIA * 60_000));
  const hora = new Date(t.getTime() - 5 * 3_600_000).toISOString().slice(11, 16);
  return dias === 0 ? hora : dias === 1 ? `${hora} de mañana` : `${hora} (+${dias} días)`;
}
