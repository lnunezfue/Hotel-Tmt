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

export const UsuarioActual = createParamDecorator((_: unknown, ctx: ExecutionContext): UsuarioSesion => {
  return ctx.switchToHttp().getRequest().usuario;
});
