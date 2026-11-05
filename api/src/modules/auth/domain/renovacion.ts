import { hashesIguales } from './token-renovacion';

export type MotivoRevocacion = 'LOGOUT' | 'INACTIVIDAD' | 'REUSO' | 'USUARIO_INACTIVO' | 'EXPIRADA' | 'ADMIN';

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

  if (hashesIguales(hashPresentado, s.refreshHash)) {
    return { tipo: 'ROTAR' };
  }

  if (s.refreshHashAnterior !== null && hashesIguales(hashPresentado, s.refreshHashAnterior)) {
    const graciaMs = c.graciaSeg * MS_POR_SEGUNDO;
    if (s.rotadaAt !== null && ahora.getTime() - s.rotadaAt.getTime() <= graciaMs) return { tipo: 'CARRERA' };
    // Un token que fue válido y ya se rotó: alguien más lo tiene.
    return { tipo: 'REVOCAR', motivo: 'REUSO' };
  }

  // Los ids de sesión son correlativos: revocar ante cualquier secreto permitiría cerrar sesiones ajenas.
  return { tipo: 'DESCONOCIDO' };
}
