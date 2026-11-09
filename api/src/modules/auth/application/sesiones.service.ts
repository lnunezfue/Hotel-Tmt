import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, sesion_usuario } from '@prisma/client';
import { contextoActual } from '../../../common/contexto-peticion';
import { sinMarcasDeTiempo, UsuarioAutenticado, UsuarioSesion } from '../../../common/usuario-actual.decorator';
import { leerConfigAuth } from '../../../config';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { decidirRenovacion, MotivoRevocacion } from '../domain/renovacion';
import { formatearToken, generarSecreto, hashesIguales, hashSecreto, parsearToken } from '../domain/token-renovacion';
import { UsuarioSesionRepository } from '../infrastructure/usuario-sesion.repository';

export interface Renovacion {
  valor: string;
  expiraAt: Date;
}

/**
 * 401 que el controlador lanza tras confirmar la transacción. `borrarCookies` es falso cuando el secreto es
 * desconocido: puede venir de una pestaña con un secreto ya superado mientras el navegador guarda el vigente.
 */
export interface Denegacion {
  tipo: 'DENEGADO';
  codigo: 'SIN_SESION' | 'SESION_CERRADA';
  motivo?: MotivoRevocacion;
  borrarCookies: boolean;
}

export type ResultadoRenovacion =
  /** `expiraAt`: fin de la sesión (para la vida de la cookie de acceso). `renovacion` solo si hubo rotación. */
  | { tipo: 'OK'; usuario: UsuarioSesion; expiraAt: Date; renovacion?: Renovacion }
  | Denegacion;

export type ResultadoCambioSucursal = { tipo: 'OK'; usuario: UsuarioSesion; expiraAt: Date } | Denegacion;

/** Cookie ausente, mal formada o de una sesión inexistente: no hay nada vigente que conservar. */
const SIN_SESION: Denegacion = { tipo: 'DENEGADO', codigo: 'SIN_SESION', borrarCookies: true };
/** Secreto que no es ni el vigente ni el anterior: no se escribe, no se audita y no se borran cookies. */
const DESCONOCIDO: Denegacion = { tipo: 'DENEGADO', codigo: 'SIN_SESION', borrarCookies: false };
const cerrada = (motivo: MotivoRevocacion): Denegacion => ({ tipo: 'DENEGADO', codigo: 'SESION_CERRADA', motivo, borrarCookies: true });

/** Las columnas son DATETIME(0): se trabaja con segundos enteros para que lo guardado sea exactamente lo decidido. */
function ahoraSegundos(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

/** En rutas públicas (login, refresh, logout) el guard no identifica al usuario; lo hace la sesión. */
function identificarEnContexto(usuarioId: number, sucursalId: number): void {
  const ctx = contextoActual();
  if (ctx && ctx.usuarioId === null) {
    ctx.usuarioId = usuarioId;
    ctx.sucursalId = sucursalId;
  }
}

/** Sesiones revocables con token de renovación rotativo (spec §5.3–§5.6). */
@Injectable()
export class SesionesService {
  private readonly cfg = leerConfigAuth();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly usuarios: UsuarioSesionRepository,
  ) {}

  /** Crea la fila de sesión dentro de la transacción del login. Devuelve el valor de la cookie de renovación. */
  async crear(tx: Prisma.TransactionClient, datos: Omit<UsuarioSesion, 'sid'>): Promise<{ usuario: UsuarioSesion; renovacion: Renovacion }> {
    const ahora = ahoraSegundos();
    const expiraAt = new Date(ahora.getTime() + this.cfg.sesionMaxHoras * 3_600_000);
    const secreto = generarSecreto();
    const ctx = contextoActual();
    const s = await tx.sesion_usuario.create({
      data: {
        usuario_id: datos.sub,
        sucursal_id: datos.sucursalId,
        refresh_hash: hashSecreto(secreto),
        ip: ctx?.ip ?? null,
        user_agent: ctx?.userAgent ?? null,
        creada_at: ahora,
        ultima_renovacion_at: ahora,
        expira_at: expiraAt,
      },
      select: { id: true },
    });
    identificarEnContexto(datos.sub, datos.sucursalId);
    return { usuario: { ...datos, sid: s.id.toString() }, renovacion: { valor: formatearToken(s.id, secreto), expiraAt } };
  }

  /**
   * Aplica la tabla de spec §5.4. Nunca lanza por resultados de negocio: las revocaciones se escriben y auditan
   * en la transacción, que se confirma, y el controlador responde 401 después.
   */
  async renovar(cookie: string | undefined): Promise<ResultadoRenovacion> {
    const token = parsearToken(cookie);
    if (!token) return SIN_SESION;
    const hashPresentado = hashSecreto(token.secreto);

    return this.prisma.$transaction(async (tx): Promise<ResultadoRenovacion> => {
      const s = await this.bloquear(tx, token.sesionId);
      if (!s) return SIN_SESION;
      identificarEnContexto(s.usuario_id, s.sucursal_id);

      const carga = await this.usuarios.cargar(tx, s.usuario_id, s.sucursal_id);
      const inactividadMin = carga.estado === 'OK' ? carga.datos.inactividadMin : await this.usuarios.inactividadMin(tx, s.usuario_id);
      const ahora = ahoraSegundos();
      const decision = decidirRenovacion(
        {
          revocadaAt: s.revocada_at,
          motivoRevocacion: s.motivo_revocacion,
          expiraAt: s.expira_at,
          ultimaRenovacionAt: s.ultima_renovacion_at,
          refreshHash: s.refresh_hash,
          refreshHashAnterior: s.refresh_hash_anterior,
          rotadaAt: s.rotada_at,
        },
        hashPresentado,
        ahora,
        { inactividadMin, accesoMin: this.cfg.accesoMin, graciaSeg: this.cfg.graciaSeg },
      );

      if (decision.tipo === 'DESCONOCIDO') return DESCONOCIDO;
      if (decision.tipo === 'RECHAZAR') return cerrada(decision.motivo);
      if (decision.tipo === 'REVOCAR') return this.revocar(tx, s, decision.motivo, ahora);
      // §5.4 paso 5: usuario inactivo o sin ninguna sucursal asignada.
      if (carga.estado !== 'OK') return this.revocar(tx, s, 'USUARIO_INACTIVO', ahora);

      const usuario: UsuarioSesion = { ...carga.datos, sid: s.id.toString() };
      if (decision.tipo === 'CARRERA') return { tipo: 'OK', usuario, expiraAt: s.expira_at };

      const secreto = generarSecreto();
      await tx.sesion_usuario.update({
        where: { id: s.id },
        data: {
          refresh_hash_anterior: s.refresh_hash,
          refresh_hash: hashSecreto(secreto),
          rotada_at: ahora,
          ultima_renovacion_at: ahora,
          sucursal_id: usuario.sucursalId, // vuelve a la principal si la activa se desasignó
        },
      });
      return {
        tipo: 'OK',
        usuario,
        expiraAt: s.expira_at,
        renovacion: { valor: formatearToken(s.id, secreto), expiraAt: s.expira_at },
      };
    });
  }

  /**
   * Revoca la sesión de la cookie si sigue vigente y quien llama demuestra tenerla (secreto vigente, o el
   * anterior dentro de la tolerancia). Sin cookie válida no hace nada: el controlador igual borra las cookies.
   */
  async cerrar(cookie: string | undefined, motivo: 'LOGOUT' | 'INACTIVIDAD'): Promise<void> {
    const token = parsearToken(cookie);
    if (!token) return;
    const hashPresentado = hashSecreto(token.secreto);

    await this.prisma.$transaction(async (tx) => {
      const s = await this.bloquear(tx, token.sesionId);
      if (!s || s.revocada_at !== null) return;
      const ahora = ahoraSegundos();
      const enGracia =
        s.refresh_hash_anterior !== null &&
        s.rotada_at !== null &&
        hashesIguales(hashPresentado, s.refresh_hash_anterior) &&
        ahora.getTime() - s.rotada_at.getTime() <= this.cfg.graciaSeg * 1000;
      if (!hashesIguales(hashPresentado, s.refresh_hash) && !enGracia) return;

      identificarEnContexto(s.usuario_id, s.sucursal_id);
      await tx.sesion_usuario.update({ where: { id: s.id }, data: { revocada_at: ahora, motivo_revocacion: motivo } });
      await this.auditoria.registrar(tx, {
        accion: 'auth.logout',
        tabla: 'sesion_usuario',
        registroId: s.id,
        despues: { motivo },
        usuarioId: s.usuario_id,
      });
    });
  }

  /**
   * Cambia la sucursal activa de la sesión `sid` (spec §5.6). 403 si la sucursal no está asignada;
   * 401 `SESION_CERRADA` si la sesión ya se revocó (el acceso aún no venció), sin modificar nada, o si pasó su
   * `expira_at` (se revoca con EXPIRADA, como en la renovación). No lanza después de escribir: la revocación
   * se confirma y el controlador responde 401 después.
   */
  async cambiarSucursal(actual: UsuarioAutenticado, sucursalId: number): Promise<ResultadoCambioSucursal> {
    if (!actual.sucursales.includes(sucursalId)) throw new ForbiddenException('No tienes acceso a esa sucursal');

    return this.prisma.$transaction(async (tx): Promise<ResultadoCambioSucursal> => {
      const s = await this.bloquear(tx, BigInt(actual.sid));
      if (!s || s.usuario_id !== actual.sub) return SIN_SESION;
      if (s.revocada_at !== null) return cerrada(s.motivo_revocacion ?? 'LOGOUT');
      const ahora = ahoraSegundos();
      // El acceso (JWT_ACCESO_MIN) puede sobrevivir a la sesión unos minutos; no sirve para seguir usándola.
      if (ahora.getTime() > s.expira_at.getTime()) return this.revocar(tx, s, 'EXPIRADA', ahora);
      // El JWT puede tener hasta JWT_ACCESO_MIN de antigüedad: se confirma la asignación contra la base.
      const asignada = await tx.usuario_sucursal.findUnique({
        where: { usuario_id_sucursal_id: { usuario_id: actual.sub, sucursal_id: sucursalId } },
      });
      if (!asignada) throw new ForbiddenException('No tienes acceso a esa sucursal');

      await tx.sesion_usuario.update({ where: { id: s.id }, data: { sucursal_id: sucursalId } });
      await this.auditoria.registrar(tx, {
        accion: 'auth.cambio_sucursal',
        tabla: 'sesion_usuario',
        registroId: s.id,
        antes: { sucursal_id: s.sucursal_id },
        despues: { sucursal_id: sucursalId },
      });

      return { tipo: 'OK', usuario: { ...sinMarcasDeTiempo(actual), sucursalId }, expiraAt: s.expira_at };
    });
  }

  /**
   * Revoca las sesiones vigentes de un usuario (desactivación, cambio de rol o sucursales, restablecimiento o
   * cambio de contraseña) dentro de la transacción del cambio. Audita cada una como en §5.4. `exceptoSid`
   * conserva la sesión desde la que el propio usuario cambió su contraseña. Devuelve cuántas cerró.
   */
  async revocarDeUsuario(
    tx: Prisma.TransactionClient,
    usuarioId: number,
    motivo: MotivoRevocacion,
    exceptoSid?: string,
  ): Promise<number> {
    const ahora = ahoraSegundos();
    const vigentes = await tx.sesion_usuario.findMany({
      where: {
        usuario_id: usuarioId,
        revocada_at: null,
        expira_at: { gt: ahora },
        ...(exceptoSid ? { NOT: { id: BigInt(exceptoSid) } } : {}),
      },
    });
    for (const s of vigentes) await this.revocar(tx, s, motivo, ahora);
    return vigentes.length;
  }

  /** Bloquea la fila (serializa renovaciones concurrentes de la misma sesión) y luego la lee. */
  private async bloquear(tx: Prisma.TransactionClient, id: bigint): Promise<sesion_usuario | null> {
    await tx.$queryRaw`SELECT id FROM sesion_usuario WHERE id = ${id} FOR UPDATE`;
    return tx.sesion_usuario.findUnique({ where: { id } });
  }

  private async revocar(
    tx: Prisma.TransactionClient,
    s: sesion_usuario,
    motivo: MotivoRevocacion,
    ahora: Date,
  ): Promise<Denegacion> {
    await tx.sesion_usuario.update({ where: { id: s.id }, data: { revocada_at: ahora, motivo_revocacion: motivo } });
    await this.auditoria.registrar(tx, {
      accion: 'auth.sesion_revocada',
      tabla: 'sesion_usuario',
      registroId: s.id,
      despues: { motivo },
      usuarioId: s.usuario_id,
    });
    return cerrada(motivo);
  }
}
