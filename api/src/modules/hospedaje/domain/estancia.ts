/**
 * Reglas de la estancia: libro de huéspedes, extensión y liquidación del check-out (RF-RES-10 a 13; spec S-06).
 */
export class ReglaEstanciaError extends Error {}
/** La habitación o la estancia no admiten la acción en su estado actual (→ 409). */
export class EstadoEstanciaError extends ReglaEstanciaError {}

export const MOTIVOS_VIAJE = ['Turismo', 'Negocios', 'Trabajo', 'Salud', 'Estudios', 'Visita familiar', 'Otro'] as const;
export type MotivoViaje = (typeof MOTIVOS_VIAJE)[number];

/** Minutos de gracia tras la salida prevista antes de cobrar otro turno (la misma que la alerta del tablero). */
export const TOLERANCIA_SALIDA_MIN = 30;
export const EXTENSION_MAX = 30;

const recortar = (v: string | null | undefined): string | null => {
  const t = v?.trim().replace(/\s+/g, ' ');
  return t ? t : null;
};

export interface DatosLibro {
  procedencia: string;
  destino?: string | null;
  motivoViaje: string;
  placaVehiculo?: string | null;
}

export function normalizarDatosLibro(d: DatosLibro): { procedencia: string; destino: string | null; motivoViaje: MotivoViaje; placaVehiculo: string | null } {
  const procedencia = recortar(d.procedencia);
  if (procedencia === null || procedencia.length < 2 || procedencia.length > 100) throw new ReglaEstanciaError('La procedencia debe tener entre 2 y 100 caracteres');
  const destino = recortar(d.destino);
  if (destino !== null && destino.length > 100) throw new ReglaEstanciaError('El destino admite hasta 100 caracteres');
  if (!(MOTIVOS_VIAJE as readonly string[]).includes(d.motivoViaje)) throw new ReglaEstanciaError(`El motivo del viaje debe ser uno de: ${MOTIVOS_VIAJE.join(', ')}`);
  const placa = recortar(d.placaVehiculo)?.toUpperCase().replace(/\s/g, '') ?? null;
  if (placa !== null && !/^[A-Z0-9-]{1,10}$/.test(placa)) throw new ReglaEstanciaError('La placa admite hasta 10 letras, dígitos o guiones');
  return { procedencia, destino, motivoViaje: d.motivoViaje as MotivoViaje, placaVehiculo: placa };
}

/** Un titular y acompañantes distintos, sin pasar la capacidad del tipo de habitación. */
export function validarHuespedes(titularId: bigint, acompanantes: bigint[], capacidad: number): void {
  const todos = [titularId, ...acompanantes];
  if (new Set(todos.map(String)).size !== todos.length) throw new ReglaEstanciaError('Un huésped aparece más de una vez');
  if (todos.length > capacidad) throw new ReglaEstanciaError(`La habitación admite ${capacidad} huéspedes y se registran ${todos.length}`);
}

export function validarExtension(turnos: number): void {
  if (!Number.isInteger(turnos) || turnos < 1 || turnos > EXTENSION_MAX) throw new ReglaEstanciaError(`La extensión debe ser de 1 a ${EXTENSION_MAX} turnos`);
}

export interface Liquidacion {
  contratados: number;
  consumidos: number;
  /** Turnos que se suman por salir después de la salida prevista y la tolerancia. */
  adicionales: number;
  precioUnitario: number;
  /** En céntimos, para no arrastrar errores de coma flotante. */
  importeCentimos: number;
}

/**
 * Turnos a cobrar al salir: los contratados, o más si el huésped se quedó pasada la tolerancia. Salir antes no
 * devuelve turnos.
 */
export function liquidar(d: { checkin: Date; salida: Date; horasTurno: number; contratados: number; precioCentimos: number }): Liquidacion {
  const turnoMs = d.horasTurno * 3_600_000;
  const usadoMs = d.salida.getTime() - d.checkin.getTime() - TOLERANCIA_SALIDA_MIN * 60_000;
  const porTiempo = usadoMs <= 0 ? 0 : Math.ceil(usadoMs / turnoMs);
  const consumidos = Math.max(d.contratados, porTiempo);
  return {
    contratados: d.contratados,
    consumidos,
    adicionales: consumidos - d.contratados,
    precioUnitario: d.precioCentimos / 100,
    importeCentimos: d.precioCentimos * consumidos,
  };
}
