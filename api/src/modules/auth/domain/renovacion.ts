import { hashesIguales } from './token-renovacion';

export type MotivoRevocacion = 'LOGOUT' | 'INACTIVIDAD' | 'REUSO' | 'USUARIO_INACTIVO' | 'EXPIRADA' | 'ADMIN' | 'CAMBIO_CLAVE';

export interface EstadoSesion {
  revocadaAt: Date | null;
  motivoRevocacion: MotivoRevocacion | null;
  expiraAt: Date;
  ultimaRenovacionAt: Date;
  refreshHash: string;
  refreshHashAnterior: string | null;
  rotadaAt: Date | null;
}

export interface ConfigRenovacion {
  inactividadMin: number;
  accesoMin: number;
  graciaSeg: number;
}

export type DecisionRenovacion =
  | { tipo: 'ROTAR' }
  | { tipo: 'CARRERA' }
  /** El secreto no corresponde ni al vigente ni al anterior: no prueba posesión de la sesión, no se toca. */
  | { tipo: 'DESCONOCIDO' }
  | { tipo: 'REVOCAR'; motivo: MotivoRevocacion }
  | { tipo: 'RECHAZAR'; motivo: MotivoRevocacion };

const MS_POR_MINUTO = 60_000;
const MS_POR_SEGUNDO = 1_000;

/**
 * Evalúa la renovación en el orden de la tabla de spec §5.4.
 * Función pura: no toca base de datos ni reloj propio.
 */
export function decidirRenovacion(
  s: EstadoSesion,
  hashPresentado: string,
  ahora: Date,
  c: ConfigRenovacion,
): DecisionRenovacion {
  const esVigente = hashesIguales(hashPresentado, s.refreshHash);
  const esAnterior = s.refreshHashAnterior !== null && hashesIguales(hashPresentado, s.refreshHashAnterior);

  // Primero la posesión: los ids de sesión son correlativos y, si un secreto desconocido llegara a las reglas
  // de tiempo, cualquiera podría revocar sesiones ajenas vencidas (y leer su motivo) enviando `<id>.<lo-que-sea>`.
  if (!esVigente && !esAnterior) return { tipo: 'DESCONOCIDO' };

  if (s.revocadaAt !== null) {
    return { tipo: 'RECHAZAR', motivo: s.motivoRevocacion ?? 'LOGOUT' };
  }

  if (ahora.getTime() > s.expiraAt.getTime()) {
    return { tipo: 'REVOCAR', motivo: 'EXPIRADA' };
  }

  const umbralInactividadMs = (c.inactividadMin + c.accesoMin) * MS_POR_MINUTO;
  if (ahora.getTime() - s.ultimaRenovacionAt.getTime() > umbralInactividadMs) {
    return { tipo: 'REVOCAR', motivo: 'INACTIVIDAD' };
  }

  if (esVigente) return { tipo: 'ROTAR' };

  const graciaMs = c.graciaSeg * MS_POR_SEGUNDO;
  if (s.rotadaAt !== null && ahora.getTime() - s.rotadaAt.getTime() <= graciaMs) return { tipo: 'CARRERA' };
  // Un token que fue válido y ya se rotó: alguien más lo tiene.
  return { tipo: 'REVOCAR', motivo: 'REUSO' };
}
