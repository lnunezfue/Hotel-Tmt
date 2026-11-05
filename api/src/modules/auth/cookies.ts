import type { CookieOptions, Response } from 'express';

export const COOKIE_ACCESO = 'hotel_sesion';
export const COOKIE_RENOVACION = 'hotel_renovacion';

const RUTA_ACCESO = '/';
const RUTA_RENOVACION = '/api/auth';

function base(path: string): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path };
}

/**
 * Cookie del JWT de acceso (spec §5.1). El JWT vence a los JWT_ACCESO_MIN minutos por su `exp`; la cookie
 * vive hasta el fin de la sesión para que, vencido el acceso, el navegador lo siga enviando y el guard
 * responda `ACCESO_EXPIRADO` (el cliente renueva) y no `SIN_SESION` (el cliente va al login). Si la cookie
 * caducara junto con el JWT, el cliente nunca vería `ACCESO_EXPIRADO`.
 */
export function fijarCookieAcceso(res: Response, jwt: string, expiraAt: Date): void {
  res.cookie(COOKIE_ACCESO, jwt, { ...base(RUTA_ACCESO), expires: expiraAt });
}

/** Cookie del token de renovación: solo viaja a /api/auth y vive hasta `expira_at` de la sesión. */
export function fijarCookieRenovacion(res: Response, valor: string, expiraAt: Date): void {
  res.cookie(COOKIE_RENOVACION, valor, { ...base(RUTA_RENOVACION), expires: expiraAt });
}

/** Borra ambas cookies con los mismos atributos con que se fijaron (si no, el navegador no las reemplaza). */
export function borrarCookies(res: Response): void {
  res.clearCookie(COOKIE_ACCESO, base(RUTA_ACCESO));
  res.clearCookie(COOKIE_RENOVACION, base(RUTA_RENOVACION));
}
