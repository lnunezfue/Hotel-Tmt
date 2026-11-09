import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsuarioSesion } from '../../../common/usuario-actual.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { SesionesService } from '../../auth/application/sesiones.service';
import { AuthService } from '../../auth/auth.service';
import {
  AsignacionSucursal,
  cambiaronSucursales,
  estadoUsuario,
  exigirPoliticaClave,
  MAX_INTENTOS,
  validarSucursales,
  validarUsername,
} from '../domain/usuario';
import { traducirError } from './errores';

export interface NuevoUsuario {
  username: string;
  nombres: string;
  apellidos: string;
  email?: string | null;
  rolId: number;
  sucursales: AsignacionSucursal[];
  clave: string;
}

export type CambiosUsuario = Partial<Omit<NuevoUsuario, 'username' | 'clave'>>;

const SELECCION = {
  id: true,
  username: true,
  nombres: true,
  apellidos: true,
  email: true,
  activo: true,
  intentos_fallidos: true,
  debe_cambiar_clave: true,
  ultimo_acceso: true,
  rol_id: true,
  rol: { select: { nombre: true } },
  usuario_sucursal: { select: { es_principal: true, sucursal: { select: { id: true, nombre: true } } }, orderBy: { sucursal_id: 'asc' } },
} satisfies Prisma.usuarioSelect;

type FilaUsuario = Prisma.usuarioGetPayload<{ select: typeof SELECCION }>;

/** Lo que se guarda en la bitácora (sin hash: `sanitizar` lo ocultaría igual, pero no hace falta leerlo). */
function instantanea(u: FilaUsuario) {
  return {
    username: u.username,
    nombres: u.nombres,
    apellidos: u.apellidos,
    email: u.email,
    rolId: u.rol_id,
    activo: u.activo,
    intentosFallidos: u.intentos_fallidos,
    sucursales: u.usuario_sucursal.map((s) => ({ id: s.sucursal.id, principal: s.es_principal })),
  };
}

/** Gestión de usuarios de la empresa (spec S-03 §4). Toda escritura se audita en la misma transacción. */
@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly sesiones: SesionesService,
  ) {}

  async listar(empresaId: number) {
    const ahora = new Date();
    const filas = await this.prisma.usuario.findMany({
      where: { empresa_id: empresaId },
      orderBy: { id: 'asc' },
      select: { ...SELECCION, _count: { select: { sesion_usuario: { where: { revocada_at: null, expira_at: { gt: ahora } } } } } },
    });
    return filas.map((f) => ({ ...this.vista(f), sesionesActivas: f._count.sesion_usuario }));
  }

  async crear(actor: UsuarioSesion, d: NuevoUsuario) {
    try {
      const username = validarUsername(d.username);
      exigirPoliticaClave(d.clave, username);
      await this.validarRolYSucursales(actor.empresaId, d.rolId, d.sucursales);
      const hash = await AuthService.hash(d.clave);
      return await this.prisma.$transaction(async (tx) => {
        const creado = await tx.usuario.create({
          data: {
            empresa_id: actor.empresaId,
            rol_id: d.rolId,
            username,
            password_hash: hash,
            nombres: d.nombres.trim(),
            apellidos: d.apellidos.trim(),
            email: d.email?.trim() || null,
            debe_cambiar_clave: true,
            usuario_sucursal: { create: d.sucursales.map((s) => ({ sucursal_id: s.id, es_principal: s.principal })) },
          },
          select: SELECCION,
        });
        await this.auditoria.registrar(tx, { accion: 'usuario.crear', tabla: 'usuario', registroId: creado.id, despues: instantanea(creado) });
        return this.vista(creado);
      });
    } catch (e) {
      traducirError(e, `El usuario «${d.username.trim().toLowerCase()}» ya existe`);
    }
  }

  async editar(actor: UsuarioSesion, id: number, c: CambiosUsuario) {
    try {
      const antes = await this.buscar(actor.empresaId, id);
      const rolId = c.rolId ?? antes.rol_id;
      const sucursalesAntes = antes.usuario_sucursal.map((s) => ({ id: s.sucursal.id, principal: s.es_principal }));
      const sucursales = c.sucursales ?? sucursalesAntes;
      await this.validarRolYSucursales(actor.empresaId, rolId, sucursales);
      if (id === actor.sub && rolId !== antes.rol_id) await this.exigirQueConserveGestion(rolId);
      const cambiaAcceso = rolId !== antes.rol_id || cambiaronSucursales(sucursalesAntes, sucursales);

      return await this.prisma.$transaction(async (tx) => {
        if (c.sucursales) {
          await tx.usuario_sucursal.deleteMany({ where: { usuario_id: id } });
          await tx.usuario_sucursal.createMany({ data: sucursales.map((s) => ({ usuario_id: id, sucursal_id: s.id, es_principal: s.principal })) });
        }
        const despues = await tx.usuario.update({
          where: { id },
          data: {
            rol_id: rolId,
            ...(c.nombres !== undefined && { nombres: c.nombres.trim() }),
            ...(c.apellidos !== undefined && { apellidos: c.apellidos.trim() }),
            ...(c.email !== undefined && { email: c.email?.trim() || null }),
          },
          select: SELECCION,
        });
        // D2: cambiar rol o sucursales cierra sus sesiones (salvo la propia, que se renueva con lo nuevo)
        const cerradas = cambiaAcceso && id !== actor.sub ? await this.sesiones.revocarDeUsuario(tx, id, 'ADMIN') : 0;
        await this.auditoria.registrar(tx, {
          accion: 'usuario.editar',
          tabla: 'usuario',
          registroId: id,
          antes: instantanea(antes),
          despues: { ...instantanea(despues), sesionesCerradas: cerradas },
        });
        return { ...this.vista(despues), sesionesCerradas: cerradas };
      });
    } catch (e) {
      traducirError(e, 'Conflicto al guardar el usuario');
    }
  }

  async desactivar(actor: UsuarioSesion, id: number) {
    if (id === actor.sub) throw new ForbiddenException('No puedes desactivar tu propio usuario');
    const antes = await this.buscar(actor.empresaId, id);
    if (!antes.activo) throw new ConflictException('El usuario ya está inactivo');
    return this.prisma.$transaction(async (tx) => {
      const despues = await tx.usuario.update({ where: { id }, data: { activo: false }, select: SELECCION });
      const cerradas = await this.sesiones.revocarDeUsuario(tx, id, 'USUARIO_INACTIVO');
      await this.auditoria.registrar(tx, { accion: 'usuario.desactivar', tabla: 'usuario', registroId: id, antes: { activo: true }, despues: { activo: false, sesionesCerradas: cerradas } });
      return { ...this.vista(despues), sesionesCerradas: cerradas };
    });
  }

  async activar(actor: UsuarioSesion, id: number) {
    const antes = await this.buscar(actor.empresaId, id);
    if (antes.activo) throw new ConflictException('El usuario ya está activo');
    return this.prisma.$transaction(async (tx) => {
      const despues = await tx.usuario.update({ where: { id }, data: { activo: true, intentos_fallidos: 0 }, select: SELECCION });
      await this.auditoria.registrar(tx, { accion: 'usuario.activar', tabla: 'usuario', registroId: id, antes: { activo: false }, despues: { activo: true } });
      return this.vista(despues);
    });
  }

  async desbloquear(actor: UsuarioSesion, id: number) {
    const antes = await this.buscar(actor.empresaId, id);
    if (antes.intentos_fallidos < MAX_INTENTOS) throw new ConflictException('El usuario no está bloqueado');
    return this.prisma.$transaction(async (tx) => {
      const despues = await tx.usuario.update({ where: { id }, data: { intentos_fallidos: 0 }, select: SELECCION });
      await this.auditoria.registrar(tx, {
        accion: 'usuario.desbloquear',
        tabla: 'usuario',
        registroId: id,
        antes: { intentosFallidos: antes.intentos_fallidos },
        despues: { intentosFallidos: 0 },
      });
      return this.vista(despues);
    });
  }

  /** Clave temporal: desbloquea, obliga a cambiarla al ingresar y cierra las sesiones abiertas. */
  async restablecerClave(actor: UsuarioSesion, id: number, clave: string) {
    if (id === actor.sub) throw new BadRequestException('Para tu propio usuario usa «Cambiar mi contraseña»');
    const antes = await this.buscar(actor.empresaId, id);
    try {
      exigirPoliticaClave(clave, antes.username);
    } catch (e) {
      traducirError(e, '');
    }
    const hash = await AuthService.hash(clave);
    return this.prisma.$transaction(async (tx) => {
      const despues = await tx.usuario.update({
        where: { id },
        data: { password_hash: hash, debe_cambiar_clave: true, intentos_fallidos: 0 },
        select: SELECCION,
      });
      const cerradas = await this.sesiones.revocarDeUsuario(tx, id, 'ADMIN');
      await this.auditoria.registrar(tx, { accion: 'usuario.restablecer_clave', tabla: 'usuario', registroId: id, despues: { debeCambiarClave: true, sesionesCerradas: cerradas } });
      return { ...this.vista(despues), sesionesCerradas: cerradas };
    });
  }

  async cerrarSesiones(actor: UsuarioSesion, id: number) {
    if (id === actor.sub) throw new BadRequestException('Para cerrar tu propia sesión usa «Cerrar sesión»');
    await this.buscar(actor.empresaId, id);
    return this.prisma.$transaction(async (tx) => {
      const cerradas = await this.sesiones.revocarDeUsuario(tx, id, 'ADMIN');
      await this.auditoria.registrar(tx, { accion: 'usuario.cerrar_sesiones', tabla: 'usuario', registroId: id, despues: { sesionesCerradas: cerradas } });
      return { sesionesCerradas: cerradas };
    });
  }

  private vista(f: FilaUsuario) {
    return {
      id: f.id,
      username: f.username,
      nombres: f.nombres,
      apellidos: f.apellidos,
      nombre: `${f.nombres} ${f.apellidos}`,
      email: f.email,
      rolId: f.rol_id,
      rol: f.rol.nombre,
      estado: estadoUsuario(f),
      debeCambiarClave: f.debe_cambiar_clave,
      ultimoAcceso: f.ultimo_acceso,
      sucursales: f.usuario_sucursal.map((s) => ({ id: s.sucursal.id, nombre: s.sucursal.nombre, principal: s.es_principal })),
    };
  }

  private async buscar(empresaId: number, id: number): Promise<FilaUsuario> {
    const u = await this.prisma.usuario.findFirst({ where: { id, empresa_id: empresaId }, select: SELECCION });
    if (!u) throw new NotFoundException('El usuario no existe');
    return u;
  }

  private async validarRolYSucursales(empresaId: number, rolId: number, sucursales: AsignacionSucursal[]) {
    const rol = await this.prisma.rol.findFirst({ where: { id: rolId, activo: true } });
    if (!rol) throw new BadRequestException('El rol no existe o está inactivo');
    const deLaEmpresa = await this.prisma.sucursal.findMany({ where: { empresa_id: empresaId, activo: true }, select: { id: true } });
    validarSucursales(sucursales, deLaEmpresa.map((s) => s.id));
  }

  /** D4: el administrador no puede quitarse a sí mismo la gestión de usuarios. */
  private async exigirQueConserveGestion(rolId: number) {
    const tiene = await this.prisma.rol_permiso.findFirst({ where: { rol_id: rolId, permiso: { codigo: 'usuario.gestionar' } } });
    if (!tiene) throw new ForbiddenException('No puedes asignarte un rol sin «usuario.gestionar»: perderías el acceso a esta pantalla');
  }
}
