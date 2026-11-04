import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsuarioSesion } from '../../../common/usuario-actual.decorator';

export type CargaUsuario = { estado: 'OK'; datos: Omit<UsuarioSesion, 'sid'> } | { estado: 'INACTIVO' | 'SIN_SUCURSALES' };

/** Lee lo que va en el JWT de acceso: rol, permisos, sucursales y la inactividad de la empresa (spec §5.4 paso 3). */
@Injectable()
export class UsuarioSesionRepository {
  /**
   * `sucursalPreferida` es la sucursal activa de la sesión; si ya no está asignada se usa la principal
   * (o la primera, si ninguna está marcada como principal).
   */
  async cargar(tx: Prisma.TransactionClient, usuarioId: number, sucursalPreferida?: number): Promise<CargaUsuario> {
    const u = await tx.usuario.findUnique({
      where: { id: usuarioId },
      include: {
        empresa: { select: { sesion_inactividad_min: true } },
        usuario_sucursal: { orderBy: { sucursal_id: 'asc' } },
        rol: { include: { rol_permiso: { include: { permiso: true } } } },
      },
    });
    if (!u || !u.activo) return { estado: 'INACTIVO' };
    if (u.usuario_sucursal.length === 0) return { estado: 'SIN_SUCURSALES' };

    const sucursales = u.usuario_sucursal.map((s) => s.sucursal_id);
    const principal = u.usuario_sucursal.find((s) => s.es_principal)?.sucursal_id ?? sucursales[0];
    const sucursalId = sucursalPreferida !== undefined && sucursales.includes(sucursalPreferida) ? sucursalPreferida : principal;
    return {
      estado: 'OK',
      datos: {
        sub: u.id,
        username: u.username,
        nombre: `${u.nombres} ${u.apellidos}`,
        empresaId: u.empresa_id,
        rol: u.rol.nombre,
        permisos: u.rol.rol_permiso.map((rp) => rp.permiso.codigo),
        sucursales,
        sucursalId,
        inactividadMin: u.empresa.sesion_inactividad_min,
      },
    };
  }

  /** Inactividad de la empresa del usuario, aunque el usuario ya no pueda iniciar sesión. */
  async inactividadMin(tx: Prisma.TransactionClient, usuarioId: number): Promise<number> {
    const u = await tx.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      select: { empresa: { select: { sesion_inactividad_min: true } } },
    });
    return u.empresa.sesion_inactividad_min;
  }
}
