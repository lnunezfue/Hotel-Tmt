import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { sinMarcasDeTiempo, UsuarioSesion } from '../../common/usuario-actual.decorator';
import { AuditoriaService } from '../auditoria/application/auditoria.service';
import { Renovacion, SesionesService } from './application/sesiones.service';
import { UsuarioSesionRepository } from './infrastructure/usuario-sesion.repository';

const MAX_INTENTOS = 3;

type MotivoFallo = 'NO_EXISTE' | 'INACTIVO' | 'BLOQUEADO' | 'CLAVE_INCORRECTA' | 'SIN_SUCURSALES';

const credencialesIncorrectas = () => new UnauthorizedException('Usuario o contraseña incorrectos');
const bloqueado = () => new ForbiddenException('Usuario bloqueado por intentos fallidos. Pide a un administrador que lo desbloquee');
const sinSucursales = () => new ForbiddenException('Tu usuario no tiene sucursales asignadas. Consulta con un administrador');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly auditoria: AuditoriaService,
    private readonly sesiones: SesionesService,
    private readonly usuarios: UsuarioSesionRepository,
  ) {}

  async login(username: string, password: string): Promise<{ acceso: string; usuario: UsuarioSesion; renovacion: Renovacion }> {
    const nombre = username.toLowerCase();
    const u = await this.prisma.usuario.findFirst({
      where: { username: nombre },
      select: { id: true, activo: true, intentos_fallidos: true, password_hash: true, _count: { select: { usuario_sucursal: true } } },
    });
    if (!u) throw await this.fallido(nombre, null, 'NO_EXISTE', credencialesIncorrectas());
    if (!u.activo) throw await this.fallido(nombre, u.id, 'INACTIVO', credencialesIncorrectas());
    if (u.intentos_fallidos >= MAX_INTENTOS) throw await this.fallido(nombre, u.id, 'BLOQUEADO', bloqueado());
    if (!(await argon2.verify(u.password_hash, password))) {
      await this.prisma.usuario.update({ where: { id: u.id }, data: { intentos_fallidos: { increment: 1 } } });
      throw await this.fallido(nombre, u.id, 'CLAVE_INCORRECTA', credencialesIncorrectas());
    }
    if (u._count.usuario_sucursal === 0) throw await this.fallido(nombre, u.id, 'SIN_SUCURSALES', sinSucursales());

    // Éxito: resetear intentos, crear la sesión y auditar se confirman juntos.
    const r = await this.prisma.$transaction(async (tx) => {
      const carga = await this.usuarios.cargar(tx, u.id);
      if (carga.estado !== 'OK') return carga.estado; // cambió entre la lectura y la transacción
      await tx.usuario.update({ where: { id: u.id }, data: { intentos_fallidos: 0, ultimo_acceso: new Date() } });
      const creada = await this.sesiones.crear(tx, carga.datos);
      await this.auditoria.registrar(tx, {
        accion: 'auth.login',
        tabla: 'sesion_usuario',
        registroId: BigInt(creada.usuario.sid),
        usuarioId: u.id,
      });
      return creada;
    });
    if (r === 'INACTIVO') throw await this.fallido(nombre, u.id, 'INACTIVO', credencialesIncorrectas());
    if (r === 'SIN_SUCURSALES') throw await this.fallido(nombre, u.id, 'SIN_SUCURSALES', sinSucursales());

    return { acceso: await this.firmarAcceso(r.usuario), usuario: r.usuario, renovacion: r.renovacion };
  }

  /**
   * Firma el JWT de acceso; descarta `iat`/`exp` de un payload ya firmado (los pone `signAsync`). Sin `venceEn`
   * dura JWT_ACCESO_MIN; con `venceEn` (segundos desde epoch) vence entonces: reemitir no prolonga el acceso.
   */
  firmarAcceso(usuario: UsuarioSesion & { iat?: number; exp?: number }, venceEn?: number): Promise<string> {
    const payload = sinMarcasDeTiempo(usuario);
    if (venceEn === undefined) return this.jwt.signAsync(payload);
    // `iat` explícito: jsonwebtoken calcula `exp = iat + expiresIn` con él, sin que un cambio de segundo lo desplace.
    const iat = Math.floor(Date.now() / 1000);
    return this.jwt.signAsync({ ...payload, iat }, { expiresIn: Math.max(1, venceEn - iat) });
  }

  /** `auth.login_fallido` es un evento de seguridad: se escribe fuera de transacción (spec §7.1) y luego se lanza el error. */
  private async fallido<E extends Error>(username: string, usuarioId: number | null, motivo: MotivoFallo, error: E): Promise<E> {
    await this.auditoria.registrar(this.prisma, {
      accion: 'auth.login_fallido',
      tabla: 'usuario',
      registroId: usuarioId,
      despues: { username, motivo },
      usuarioId: null,
    });
    return error;
  }

  static hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }
}
