import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { RequierePermiso } from '../auth/permisos.decorator';
import { Auditar } from '../auditoria/auditar.decorator';
import { UsuarioActual, UsuarioSesion } from '../../common/usuario-actual.decorator';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { UsuariosService } from './application/usuarios.service';
import { RolesService } from './application/roles.service';

const Sucursales = z.array(z.object({ id: z.number().int().positive(), principal: z.boolean() })).min(1).max(50);
const Texto = (max: number) => z.string().trim().min(1).max(max);
const Email = z.string().trim().email().max(120).nullable().optional().or(z.literal('').transform(() => null));

const NuevoUsuarioSchema = z.object({
  username: z.string().min(3).max(50),
  nombres: Texto(100),
  apellidos: Texto(100),
  email: Email,
  rolId: z.number().int().positive(),
  sucursales: Sucursales,
  clave: z.string().min(1).max(200),
});
const EditarUsuarioSchema = z
  .object({ nombres: Texto(100), apellidos: Texto(100), email: Email, rolId: z.number().int().positive(), sucursales: Sucursales })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'No hay cambios');
const ClaveSchema = z.object({ clave: z.string().min(1).max(200) });
const PermisosSchema = z.object({ permisos: z.array(z.string().min(3).max(60)).max(200) });
const NuevoRolSchema = z.object({ nombre: z.string().trim().min(3).max(50).regex(/^[A-Za-z_ ]+$/, 'Solo letras, espacios y guion bajo'), descripcion: z.string().max(200).optional() }).merge(PermisosSchema);

@ApiTags('organizacion')
@Controller('organizacion')
export class OrganizacionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usuariosSvc: UsuariosService,
    private readonly rolesSvc: RolesService,
  ) {}

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

  /** Todas las sucursales activas de la empresa, para asignarlas a usuarios. */
  @RequierePermiso('usuario.ver')
  @Get('sucursales/todas')
  todasLasSucursales(@UsuarioActual() u: UsuarioSesion) {
    return this.prisma.sucursal.findMany({
      where: { empresa_id: u.empresaId, activo: true },
      select: { id: true, nombre: true, tipo: true, codigo_establecimiento: true },
      orderBy: { id: 'asc' },
    });
  }

  // ── Usuarios (S-03) ──────────────────────────────────────────────

  @RequierePermiso('usuario.ver')
  @Get('usuarios')
  usuarios(@UsuarioActual() u: UsuarioSesion) {
    return this.usuariosSvc.listar(u.empresaId);
  }

  @RequierePermiso('usuario.gestionar')
  @Auditar('usuario.crear')
  @Post('usuarios')
  crearUsuario(@UsuarioActual() u: UsuarioSesion, @Body(new ZodValidationPipe(NuevoUsuarioSchema)) body: z.infer<typeof NuevoUsuarioSchema>) {
    return this.usuariosSvc.crear(u, body);
  }

  @RequierePermiso('usuario.gestionar')
  @Auditar('usuario.editar')
  @Patch('usuarios/:id')
  editarUsuario(
    @UsuarioActual() u: UsuarioSesion,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(EditarUsuarioSchema)) body: z.infer<typeof EditarUsuarioSchema>,
  ) {
    return this.usuariosSvc.editar(u, id, body);
  }

  @RequierePermiso('usuario.gestionar')
  @Auditar('usuario.desactivar')
  @Post('usuarios/:id/desactivar')
  @HttpCode(200)
  desactivar(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.usuariosSvc.desactivar(u, id);
  }

  @RequierePermiso('usuario.gestionar')
  @Auditar('usuario.activar')
  @Post('usuarios/:id/activar')
  @HttpCode(200)
  activar(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.usuariosSvc.activar(u, id);
  }

  @RequierePermiso('usuario.gestionar')
  @Auditar('usuario.desbloquear')
  @Post('usuarios/:id/desbloquear')
  @HttpCode(200)
  desbloquear(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.usuariosSvc.desbloquear(u, id);
  }

  @RequierePermiso('usuario.gestionar')
  @Auditar('usuario.restablecer_clave')
  @Post('usuarios/:id/restablecer-clave')
  @HttpCode(200)
  restablecerClave(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(ClaveSchema)) body: z.infer<typeof ClaveSchema>) {
    return this.usuariosSvc.restablecerClave(u, id, body.clave);
  }

  @RequierePermiso('usuario.gestionar')
  @Auditar('usuario.cerrar_sesiones')
  @Post('usuarios/:id/cerrar-sesiones')
  @HttpCode(200)
  cerrarSesiones(@UsuarioActual() u: UsuarioSesion, @Param('id', ParseIntPipe) id: number) {
    return this.usuariosSvc.cerrarSesiones(u, id);
  }

  // ── Roles y permisos ─────────────────────────────────────────────

  @RequierePermiso('usuario.ver')
  @Get('roles')
  roles() {
    return this.rolesSvc.listar();
  }

  @RequierePermiso('usuario.ver')
  @Get('permisos')
  permisos() {
    return this.rolesSvc.permisos();
  }

  @RequierePermiso('usuario.gestionar')
  @Auditar('rol.crear')
  @Post('roles')
  crearRol(@Body(new ZodValidationPipe(NuevoRolSchema)) body: z.infer<typeof NuevoRolSchema>) {
    return this.rolesSvc.crear(body);
  }

  @RequierePermiso('usuario.gestionar')
  @Auditar('rol.editar_permisos')
  @Put('roles/:id/permisos')
  editarPermisos(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(PermisosSchema)) body: z.infer<typeof PermisosSchema>) {
    return this.rolesSvc.editarPermisos(id, body.permisos);
  }
}
