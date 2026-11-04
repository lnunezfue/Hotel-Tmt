import type { Estado } from '../../lib/api';

export const ESTADOS: Estado[] = ['DESOCUPADA', 'RESERVADA', 'CONFIRMADA', 'OCUPADA', 'LIMPIEZA', 'MANTENIMIENTO'];

export const ESTILO_ESTADO: Record<Estado, { etiqueta: string; fondo: string; texto: string; borde: string; punto: string }> = {
  DESOCUPADA: { etiqueta: 'Desocupada', fondo: 'bg-desocupada/8', texto: 'text-desocupada', borde: 'border-desocupada/40', punto: 'bg-desocupada' },
  RESERVADA: { etiqueta: 'Reservada', fondo: 'bg-reservada/8', texto: 'text-reservada', borde: 'border-reservada/40', punto: 'bg-reservada' },
  CONFIRMADA: { etiqueta: 'Confirmada', fondo: 'bg-confirmada/8', texto: 'text-confirmada', borde: 'border-confirmada/40', punto: 'bg-confirmada' },
  OCUPADA: { etiqueta: 'Ocupada', fondo: 'bg-ocupada/8', texto: 'text-ocupada', borde: 'border-ocupada/40', punto: 'bg-ocupada' },
  LIMPIEZA: { etiqueta: 'Limpieza', fondo: 'bg-limpieza/10', texto: 'text-limpieza', borde: 'border-limpieza/40', punto: 'bg-limpieza' },
  MANTENIMIENTO: { etiqueta: 'Mantenimiento', fondo: 'bg-mantenimiento/10', texto: 'text-mantenimiento', borde: 'border-mantenimiento/40', punto: 'bg-mantenimiento' },
};

/** Texto de acción para cada cambio de estado, como lo diría recepción. */
export function accionHacia(estado: Estado): string {
  return {
    DESOCUPADA: 'Marcar disponible',
    RESERVADA: 'Marcar reservada',
    CONFIRMADA: 'Confirmar reserva',
    OCUPADA: 'Marcar ocupada',
    LIMPIEZA: 'Enviar a limpieza',
    MANTENIMIENTO: 'Enviar a mantenimiento',
  }[estado];
}

/** Tiempo restante legible hasta la salida prevista ("2 h 15 min", "vencida hace 40 min"). */
export function tiempoRestante(salida: Date, ahora: Date): string {
  const min = Math.round((salida.getTime() - ahora.getTime()) / 60000);
  const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
  return min < 0 ? `vencida hace ${fmt(-min)}` : `sale en ${fmt(min)}`;
}
