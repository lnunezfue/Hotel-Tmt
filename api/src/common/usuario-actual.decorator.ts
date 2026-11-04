import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface UsuarioSesion {
  sub: number;
  username: string;
  nombre: string;
  empresaId: number;
  rol: string;
  permisos: string[];
  sucursales: number[];
  sucursalId: number;
}

export const UsuarioActual = createParamDecorator((_: unknown, ctx: ExecutionContext): UsuarioSesion => {
  return ctx.switchToHttp().getRequest().usuario;
});
