/** Motivos del viaje del libro de huéspedes (RF-RES-11); la API valida la misma lista. */
export const MOTIVOS_VIAJE = ['Turismo', 'Negocios', 'Trabajo', 'Salud', 'Estudios', 'Visita familiar', 'Otro'] as const;

/** Una empresa (RUC 20) reserva y recibe la factura, pero no se aloja. */
export const esEmpresa = (documento: string) => /^RUC 20\d{9}$/.test(documento);

/** Turnos que se sumarían por salir ahora (misma regla que la API: 30 min de tolerancia). */
export function turnosPorSalidaTardia(salidaPrevista: string, ahora: Date, horasTurno: number, toleranciaMin = 30): number {
  const exceso = ahora.getTime() - Date.parse(salidaPrevista);
  if (exceso <= toleranciaMin * 60_000) return 0;
  return Math.ceil(exceso / (horasTurno * 3_600_000));
}
