import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { PERMISO_KEY, PUBLICO_KEY } from './permisos.decorator';
import { COOKIE_ACCESO } from './cookies';
import { errorSesion } from './errores';
import { contextoActual } from '../../common/contexto-peticion';
import { UsuarioSesion } from '../../common/usuario-actual.decorator';

const esEntero = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Rechaza tokens con otra forma (p. ej. emitidos antes de S-02, sin `sid`). */
function esUsuarioSesion(p: object): p is UsuarioSesion {
  const u = p as Partial<Record<keyof UsuarioSesion, unknown>>;
  return (
    esEntero(u.sub) &&
    typeof u.sid === 'string' &&
    /^[1-9]\d{0,18}$/.test(u.sid) &&
    esEntero(u.sucursalId) &&
    esEntero(u.inactividadMin) &&
    Array.isArray(u.permisos) &&
    Array.isArray(u.sucursales)
  );
}

/**
 * Guard global: valida la cookie de acceso y el permiso declarado en el endpoint, sin consultar la base
 * (spec §5.2). Sin cookie o firma inválida → 401 SIN_SESION; JWT vencido → 401 ACCESO_EXPIRADO.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const objetivo = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO_KEY, objetivo)) return true;

    const req = ctx.switchToHttp().getRequest();
    const token: unknown = req.cookies?.[COOKIE_ACCESO];
    if (typeof token !== 'string' || token === '') throw errorSesion('SIN_SESION');
    let usuario: UsuarioSesion;
    try {
      usuario = await this.jwt.verifyAsync<UsuarioSesion>(token);
    } catch (e) {
      throw errorSesion(e instanceof TokenExpiredError ? 'ACCESO_EXPIRADO' : 'SIN_SESION');
    }
    if (!esUsuarioSesion(usuario)) throw errorSesion('SIN_SESION');

    req.usuario = usuario;
    const contexto = contextoActual();
    if (contexto) {
      contexto.usuarioId = usuario.sub;
      contexto.sucursalId = usuario.sucursalId;
    }

    const permiso = this.reflector.getAllAndOverride<string>(PERMISO_KEY, objetivo);
    if (permiso && !usuario.permisos.includes(permiso)) {
      throw new ForbiddenException(`Tu rol no tiene el permiso «${permiso}»`);
    }
    return true;
  }
}
