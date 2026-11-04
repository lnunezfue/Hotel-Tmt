import { UnauthorizedException } from '@nestjs/common';
import type { MotivoRevocacion } from './domain/renovacion';

export type CodigoSesion = 'SIN_SESION' | 'ACCESO_EXPIRADO' | 'SESION_CERRADA';

const MENSAJES: Record<CodigoSesion, string> = {
  SIN_SESION: 'Inicia sesión para continuar',
  ACCESO_EXPIRADO: 'Tu sesión necesita renovarse',
  SESION_CERRADA: 'Tu sesión se cerró. Vuelve a iniciar sesión',
};

/** 401 con cuerpo `{ message, codigo, motivo? }` (spec §10). */
export function errorSesion(codigo: CodigoSesion, motivo?: MotivoRevocacion): UnauthorizedException {
  return new UnauthorizedException(motivo ? { message: MENSAJES[codigo], codigo, motivo } : { message: MENSAJES[codigo], codigo });
}
