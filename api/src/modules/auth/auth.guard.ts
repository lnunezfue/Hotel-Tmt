import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PERMISO_KEY, PUBLICO_KEY } from './permisos.decorator';
import { contextoActual } from '../../common/contexto-peticion';
import { UsuarioSesion } from '../../common/usuario-actual.decorator';

export const COOKIE_SESION = 'hotel_sesion';

/** Guard global: valida la cookie de sesión y el permiso declarado en el endpoint. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const objetivo = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO_KEY, objetivo)) return true;

    const req = ctx.switchToHttp().getRequest();
    const token: string | undefined = req.cookies?.[COOKIE_SESION];
    if (!token) throw new UnauthorizedException('Inicia sesión para continuar');
    try {
      const usuario = await this.jwt.verifyAsync<UsuarioSesion>(token);
      req.usuario = usuario;
      const ctx = contextoActual();
      if (ctx) {
        ctx.usuarioId = usuario.sub;
        ctx.sucursalId = usuario.sucursalId;
      }
    } catch {
      throw new UnauthorizedException('Tu sesión expiró. Vuelve a iniciar sesión');
    }

    const permiso = this.reflector.getAllAndOverride<string>(PERMISO_KEY, objetivo);
    if (permiso && !(req.usuario as UsuarioSesion).permisos.includes(permiso)) {
      throw new ForbiddenException(`Tu rol no tiene el permiso «${permiso}»`);
    }
    return true;
  }
}
