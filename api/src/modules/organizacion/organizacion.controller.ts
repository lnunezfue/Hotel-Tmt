import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { RequierePermiso } from '../auth/permisos.decorator';
import { UsuarioActual, UsuarioSesion } from '../../common/usuario-actual.decorator';

@ApiTags('organizacion')
@Controller('organizacion')
export class OrganizacionController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('empresa')
  empresa(@UsuarioActual() u: UsuarioSesion) {
    return this.prisma.empresa.findUnique({
      where: { id: u.empresaId },
      select: { id: true, ruc: true, razon_social: true, nombre_comercial: true, direccion_fiscal: true, ubigeo_codigo: true, sunat_entorno: true },
    });
  }

  /** Solo las sucursales a las que el usuario tiene acceso (RF-SEG-03). */
  @Get('sucursales')
  sucursales(@UsuarioActual() u: UsuarioSesion) {
    return this.prisma.sucursal.findMany({
      where: { empresa_id: u.empresaId, id: { in: u.sucursales }, activo: true },
      select: { id: true, nombre: true, tipo: true, codigo_establecimiento: true, direccion: true },
      orderBy: { id: 'asc' },
    });
  }

  @RequierePermiso('usuario.ver')
  @Get('usuarios')
  async usuarios(@UsuarioActual() u: UsuarioSesion) {
    const filas = await this.prisma.usuario.findMany({
      where: { empresa_id: u.empresaId },
      orderBy: { id: 'asc' },
      select: {
        id: true, username: true, nombres: true, apellidos: true, email: true, activo: true,
        intentos_fallidos: true, ultimo_acceso: true,
        rol: { select: { nombre: true } },
        usuario_sucursal: { select: { es_principal: true, sucursal: { select: { id: true, nombre: true } } } },
      },
    });
    return filas.map((f) => ({
      id: f.id, username: f.username, nombre: `${f.nombres} ${f.apellidos}`, email: f.email, rol: f.rol.nombre,
      estado: !f.activo ? 'INACTIVO' : f.intentos_fallidos >= 3 ? 'BLOQUEADO' : 'ACTIVO',
      ultimoAcceso: f.ultimo_acceso,
      sucursales: f.usuario_sucursal.map((s) => ({ id: s.sucursal.id, nombre: s.sucursal.nombre, principal: s.es_principal })),
    }));
  }

  @RequierePermiso('usuario.ver')
  @Get('roles')
  async roles() {
    const roles = await this.prisma.rol.findMany({ include: { rol_permiso: { include: { permiso: true } } }, orderBy: { id: 'asc' } });
    return roles.map((r) => ({ id: r.id, nombre: r.nombre, descripcion: r.descripcion, permisos: r.rol_permiso.map((p) => p.permiso.codigo) }));
  }
}
