import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { COOKIE_SESION } from './auth.guard';
import { Publico } from './permisos.decorator';
import { UsuarioActual, UsuarioSesion } from '../../common/usuario-actual.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';

const LoginSchema = z.object({ username: z.string().min(3).max(50), password: z.string().min(1).max(200) });
const SucursalSchema = z.object({ sucursalId: z.number().int().positive() });

const opcionesCookie = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(LoginSchema)) body: z.infer<typeof LoginSchema>, @Res({ passthrough: true }) res: Response) {
    const { token, usuario } = await this.auth.login(body.username, body.password);
    res.cookie(COOKIE_SESION, token, opcionesCookie);
    return usuario;
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_SESION, { path: '/' });
  }

  @Get('me')
  me(@UsuarioActual() usuario: UsuarioSesion) {
    return usuario;
  }

  @Post('sucursal')
  @HttpCode(200)
  async sucursal(
    @UsuarioActual() actual: UsuarioSesion,
    @Body(new ZodValidationPipe(SucursalSchema)) body: z.infer<typeof SucursalSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, usuario } = await this.auth.cambiarSucursal(actual, body.sucursalId);
    res.cookie(COOKIE_SESION, token, opcionesCookie);
    return usuario;
  }
}
