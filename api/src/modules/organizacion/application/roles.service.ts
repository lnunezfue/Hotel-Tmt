import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { ROL_ADMINISTRADOR } from '../domain/usuario';
import { traducirError } from './errores';

/**
 * Roles y su matriz de permisos (spec S-03 §4.1). Editar permisos no cierra sesiones: la renovación relee los
 * permisos y el cambio aplica en ≤ 15 min (D3).
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar() {
    const roles = await this.prisma.rol.findMany({
      include: { rol_permiso: { include: { permiso: true } }, _count: { select: { usuario: { where: { activo: true } } } } },
      orderBy: { id: 'asc' },
    });
    return roles.map((r) => ({
      id: r.id,
      nombre: r.nombre,
      descripcion: r.descripcion,
      editable: r.nombre !== ROL_ADMINISTRADOR,
      usuarios: r._count.usuario,
      permisos: r.rol_permiso.map((p) => p.permiso.codigo).sort(),
    }));
  }

  async permisos() {
    const filas = await this.prisma.permiso.findMany({ orderBy: [{ modulo: 'asc' }, { codigo: 'asc' }] });
    return filas.map((p) => ({ codigo: p.codigo, modulo: p.modulo, descripcion: p.descripcion }));
  }

  async crear(d: { nombre: string; descripcion?: string | null; permisos: string[] }) {
    const nombre = d.nombre.trim().toUpperCase();
    const ids = await this.idsDePermisos(d.permisos);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const rol = await tx.rol.create({
          data: { nombre, descripcion: d.descripcion?.trim() || null, rol_permiso: { create: ids.map((permiso_id) => ({ permiso_id })) } },
        });
        await this.auditoria.registrar(tx, { accion: 'rol.crear', tabla: 'rol', registroId: rol.id, despues: { nombre, permisos: [...d.permisos].sort() } });
        return { id: rol.id, nombre };
      });
    } catch (e) {
      traducirError(e, `El rol «${nombre}» ya existe`);
    }
  }

  async editarPermisos(id: number, codigos: string[]) {
    const rol = await this.prisma.rol.findUnique({ where: { id }, include: { rol_permiso: { include: { permiso: true } } } });
    if (!rol) throw new NotFoundException('El rol no existe');
    if (rol.nombre === ROL_ADMINISTRADOR) throw new ConflictException('El rol ADMINISTRADOR tiene todos los permisos y no se edita');
    const ids = await this.idsDePermisos(codigos);
    const antes = rol.rol_permiso.map((p) => p.permiso.codigo).sort();
    return this.prisma.$transaction(async (tx) => {
      await tx.rol_permiso.deleteMany({ where: { rol_id: id } });
      await tx.rol_permiso.createMany({ data: ids.map((permiso_id) => ({ rol_id: id, permiso_id })) });
      const despues = [...new Set(codigos)].sort();
      await this.auditoria.registrar(tx, { accion: 'rol.editar_permisos', tabla: 'rol', registroId: id, antes: { permisos: antes }, despues: { permisos: despues } });
      return { id, nombre: rol.nombre, permisos: despues };
    });
  }

  private async idsDePermisos(codigos: string[]): Promise<number[]> {
    const unicos = [...new Set(codigos)];
    const filas = await this.prisma.permiso.findMany({ where: { codigo: { in: unicos } }, select: { id: true, codigo: true } });
    if (filas.length !== unicos.length) {
      const faltan = unicos.filter((c) => !filas.some((f) => f.codigo === c));
      throw new BadRequestException(`Permisos desconocidos: ${faltan.join(', ')}`);
    }
    return filas.map((f) => f.id);
  }
}
