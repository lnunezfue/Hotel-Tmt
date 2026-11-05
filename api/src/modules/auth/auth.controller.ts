import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { Denegacion, SesionesService } from './application/sesiones.service';
import { borrarCookies, COOKIE_RENOVACION, fijarCookieAcceso, fijarCookieRenovacion } from './cookies';
import { errorSesion } from './errores';
import { Publico } from './permisos.decorator';
import { Auditar } from '../auditoria/auditar.decorator';
import { UsuarioActual, UsuarioAutenticado, UsuarioSesion } from '../../common/usuario-actual.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';

const LoginSchema = z.object({ username: z.string().min(3).max(50), password: z.string().min(1).max(200) });
const SucursalSchema = z.object({ sucursalId: z.number().int().positive() });
// El cuerpo es opcional: sin cuerpo, Express deja `req.body` sin definir.
const LogoutSchema = z.object({ motivo: z.literal('INACTIVIDAD').optional() }).optional();

/** cookie-parser convierte los valores `j:…` en objetos: solo se aceptan cadenas. */
function cookie(req: Request, nombre: string): string | undefined {
  const valor: unknown = req.cookies?.[nombre];
  return typeof valor === 'string' ? valor : undefined;
}

/** Arma el 401 de una denegación ya confirmada; borra las cookies salvo ante un secreto desconocido. */
function denegar(res: Response, d: Denegacion): UnauthorizedException {
  if (d.borrarCookies) borrarCookies(res);
  return errorSesion(d.codigo, d.motivo);
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sesiones: SesionesService,
  ) {}

  @Publico()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(200)
  @Auditar('auth.login')
  async login(@Body(new ZodValidationPipe(LoginSchema)) body: z.infer<typeof LoginSchema>, @Res({ passthrough: true }) res: Response) {
    const { acceso, usuario, renovacion } = await this.auth.login(body.username, body.password);
    fijarCookieAcceso(res, acceso, renovacion.expiraAt);
    fijarCookieRenovacion(res, renovacion.valor, renovacion.expiraAt);
    return usuario;
  }

  /** Spec §5.4. Las revocaciones ya están confirmadas cuando se lanza el 401. */
  @Publico()
  @UseGuards(ThrottlerGuard)
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.sesiones.renovar(cookie(req, COOKIE_RENOVACION));
    if (r.tipo === 'DENEGADO') throw denegar(res, r);
    fijarCookieAcceso(res, await this.auth.firmarAcceso(r.usuario), r.expiraAt);
    if (r.renovacion) fijarCookieRenovacion(res, r.renovacion.valor, r.renovacion.expiraAt);
    return r.usuario;
  }

  /** Público para que funcione con el acceso vencido (spec §5.5). */
  @Publico()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Body(new ZodValidationPipe(LogoutSchema)) body: z.infer<typeof LogoutSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      await this.sesiones.cerrar(cookie(req, COOKIE_RENOVACION), body?.motivo ?? 'LOGOUT');
    } finally {
      borrarCookies(res);
    }
  }

  @Get('me')
  me(@UsuarioActual() usuario: UsuarioSesion) {
    return usuario;
  }

  @Post('sucursal')
  @HttpCode(200)
  @Auditar('auth.cambio_sucursal')
  async sucursal(
    @UsuarioActual() actual: UsuarioAutenticado,
    @Body(new ZodValidationPipe(SucursalSchema)) body: z.infer<typeof SucursalSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.sesiones.cambiarSucursal(actual, body.sucursalId);
    if (r.tipo === 'DENEGADO') throw denegar(res, r);
    // Vence cuando vencía el acceso presentado: cambiar de sucursal no puede prolongar la sesión (spec §5.6).
    fijarCookieAcceso(res, await this.auth.firmarAcceso(r.usuario, actual.exp), r.expiraAt);
    return r.usuario;
  }
}
