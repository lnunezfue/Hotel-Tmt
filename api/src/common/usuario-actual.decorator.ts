import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Contenido del JWT de acceso (spec §5.1). */
export interface UsuarioSesion {
  sub: number;
  /** id de `sesion_usuario` (BIGINT, como texto). */
  sid: string;
  username: string;
  nombre: string;
  empresaId: number;
  rol: string;
  permisos: string[];
  sucursales: number[];
  sucursalId: number;
  /** `empresa.sesion_inactividad_min`: el cliente cierra la sesión tras estos minutos sin actividad. */
  inactividadMin: number;
}

/** Usuario de la petición: el JWT de acceso ya verificado, con las marcas de tiempo que pone la firma (segundos). */
export interface UsuarioAutenticado extends UsuarioSesion {
  iat?: number;
  /** Vencimiento del JWT presentado; un JWT reemitido a partir de este no puede vencer después. */
  exp: number;
}

/** Quita `iat`/`exp` para volver a firmar (jsonwebtoken rechaza `exp` en el contenido junto con `expiresIn`). */
export function sinMarcasDeTiempo(u: UsuarioSesion & { iat?: number; exp?: number }): UsuarioSesion {
  const { iat: _iat, exp: _exp, ...datos } = u;
  return datos;
}

export const UsuarioActual = createParamDecorator((_: unknown, ctx: ExecutionContext): UsuarioAutenticado => {
  return ctx.switchToHttp().getRequest().usuario;
});
