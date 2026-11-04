import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { UsuarioSesion } from '../../common/usuario-actual.decorator';

const MAX_INTENTOS = 3;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  async login(username: string, password: string): Promise<{ token: string; usuario: UsuarioSesion }> {
    const u = await this.prisma.usuario.findFirst({
      where: { username: username.toLowerCase() },
      include: { usuario_sucursal: true, rol: { include: { rol_permiso: { include: { permiso: true } } } } },
    });
    if (!u || !u.activo) throw new UnauthorizedException('Usuario o contraseña incorrectos');
    if (u.intentos_fallidos >= MAX_INTENTOS) {
      throw new ForbiddenException('Usuario bloqueado por intentos fallidos. Pide a un administrador que lo desbloquee');
    }
    if (!(await argon2.verify(u.password_hash, password))) {
      await this.prisma.usuario.update({ where: { id: u.id }, data: { intentos_fallidos: { increment: 1 } } });
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }
    await this.prisma.usuario.update({ where: { id: u.id }, data: { intentos_fallidos: 0, ultimo_acceso: new Date() } });

    const sucursales = u.usuario_sucursal.map((s) => s.sucursal_id);
    const principal = u.usuario_sucursal.find((s) => s.es_principal)?.sucursal_id ?? sucursales[0];
    const usuario: UsuarioSesion = {
      sub: u.id,
      username: u.username,
      nombre: `${u.nombres} ${u.apellidos}`,
      empresaId: u.empresa_id,
      rol: u.rol.nombre,
      permisos: u.rol.rol_permiso.map((rp) => rp.permiso.codigo),
      sucursales,
      sucursalId: principal,
    };
    return { token: await this.jwt.signAsync(usuario), usuario };
  }

  /** Cambia la sucursal activa. Solo se permiten sucursales asignadas en usuario_sucursal. */
  async cambiarSucursal(actual: UsuarioSesion, sucursalId: number) {
    if (!actual.sucursales.includes(sucursalId)) throw new ForbiddenException('No tienes acceso a esa sucursal');
    const { iat: _iat, exp: _exp, ...resto } = actual as UsuarioSesion & { iat?: number; exp?: number };
    const usuario = { ...resto, sucursalId };
    return { token: await this.jwt.signAsync(usuario), usuario };
  }

  static hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }
}
