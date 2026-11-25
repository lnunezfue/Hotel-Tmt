import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { elegirSerie, esTipoSerie, legible, normalizarSerie, ReglaSerieError, TipoSerie, TIPOS_VENTA, validarCorrelativoInicial } from '../domain/serie';

const INCLUIR = {
  tipo_comprobante: { select: { codigo: true, descripcion: true } },
  usuario_serie: { select: { usuario: { select: { id: true, username: true, nombres: true, apellidos: true } } } },
  _count: { select: { comprobante: true } },
} satisfies Prisma.serieInclude;
type FilaSerie = Prisma.serieGetPayload<{ include: typeof INCLUIR }>;

function vista(s: FilaSerie) {
  return {
    id: s.id,
    tipo: s.tipo_comprobante.codigo,
    tipoDescripcion: s.tipo_comprobante.descripcion,
    serie: s.serie,
    ultimoNumero: s.correlativo_actual,
    siguiente: `${s.serie}-${String(s.correlativo_actual + 1).padStart(8, '0')}`,
    comprobantes: s._count.comprobante,
    contingencia: s.es_contingencia,
    activo: s.activo,
    usuarios: s.usuario_serie.map((u) => ({ id: u.usuario.id, username: u.usuario.username, nombre: `${u.usuario.nombres} ${u.usuario.apellidos}` })),
  };
}

function traducir(e: unknown): never {
  if (e instanceof ReglaSerieError) throw new BadRequestException(e.message);
  throw e;
}

/** Series de comprobantes de la sucursal del token y su asignación a usuarios (RF-FAC-01, RF-FAC-02; spec S-07). */
@Injectable()
export class SeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(sucursalId: number) {
    const filas = await this.prisma.serie.findMany({ where: { sucursal_id: sucursalId }, include: INCLUIR, orderBy: [{ tipo_comprobante_id: 'asc' }, { serie: 'asc' }] });
    return filas.map(vista);
  }

  /** Usuarios activos de la empresa con acceso a la sucursal: a quiénes se les puede asignar una serie. */
  async usuariosAsignables(empresaId: number, sucursalId: number) {
    const filas = await this.prisma.usuario.findMany({
      where: { empresa_id: empresaId, activo: true, usuario_sucursal: { some: { sucursal_id: sucursalId } } },
      select: { id: true, username: true, nombres: true, apellidos: true, rol: { select: { nombre: true } } },
      orderBy: { username: 'asc' },
    });
    return filas.map((u) => ({ id: u.id, username: u.username, nombre: `${u.nombres} ${u.apellidos}`, rol: u.rol.nombre }));
  }

  async crear(sucursalId: number, d: { tipo: string; serie: string; correlativoInicial?: number }) {
    let serie: string;
    try {
      if (!esTipoSerie(d.tipo)) throw new ReglaSerieError('Tipo de comprobante no válido');
      serie = normalizarSerie(d.tipo, d.serie);
      validarCorrelativoInicial(d.correlativoInicial ?? 0);
    } catch (e) {
      traducir(e);
    }
    const tipo = await this.prisma.tipo_comprobante.findUniqueOrThrow({ where: { codigo: d.tipo } });
    try {
      const creada = await this.prisma.$transaction(async (tx) => {
        const s = await tx.serie.create({ data: { sucursal_id: sucursalId, tipo_comprobante_id: tipo.id, serie, correlativo_actual: d.correlativoInicial ?? 0 }, include: INCLUIR });
        await this.auditoria.registrar(tx, { accion: 'serie.crear', tabla: 'serie', registroId: s.id, despues: { tipo: d.tipo, serie, correlativoInicial: d.correlativoInicial ?? 0 } });
        return s;
      });
      return vista(creada);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Ya existe la serie ${serie} de ${legible(d.tipo as TipoSerie)} en esta sucursal`);
      throw e;
    }
  }

  /** Solo se activa o desactiva: cambiar la serie o su número dejaría comprobantes con saltos o duplicados (D2). */
  async editar(sucursalId: number, id: number, activo: boolean) {
    const antes = await this.prisma.serie.findFirst({ where: { id, sucursal_id: sucursalId }, include: INCLUIR });
    if (!antes) throw new NotFoundException('La serie no existe en tu sucursal');
    const editada = await this.prisma.$transaction(async (tx) => {
      if (!activo && antes.activo && (TIPOS_VENTA as string[]).includes(antes.tipo_comprobante.codigo)) {
        // Bloquea las series del tipo: dos desactivaciones simultáneas no pueden dejar la sucursal sin ninguna (D3).
        const activas = await tx.$queryRaw<Array<{ id: number }>>`
          SELECT id FROM serie WHERE sucursal_id = ${sucursalId} AND tipo_comprobante_id = ${antes.tipo_comprobante_id} AND activo = 1 FOR UPDATE`;
        if (activas.length <= 1) throw new ConflictException(`Es la única serie activa de ${legible(antes.tipo_comprobante.codigo as TipoSerie)}: crea o activa otra antes`);
      }
      const despues = await tx.serie.update({ where: { id }, data: { activo }, include: INCLUIR });
      await this.auditoria.registrar(tx, { accion: 'serie.editar', tabla: 'serie', registroId: id, antes: { activo: antes.activo }, despues: { activo } });
      return despues;
    });
    return vista(editada);
  }

  /** Reemplaza los usuarios de la serie. Una serie con usuarios es exclusiva de ellos; sin usuarios, es compartida. */
  async asignar(empresaId: number, sucursalId: number, id: number, usuarioIds: number[]) {
    const serie = await this.prisma.serie.findFirst({ where: { id, sucursal_id: sucursalId }, include: INCLUIR });
    if (!serie) throw new NotFoundException('La serie no existe en tu sucursal');
    const ids = [...new Set(usuarioIds)];
    const validos = await this.usuariosAsignables(empresaId, sucursalId);
    const ajeno = ids.find((u) => !validos.some((v) => v.id === u));
    if (ajeno !== undefined) throw new BadRequestException('Hay usuarios que no existen, están inactivos o no tienen acceso a esta sucursal');
    const despues = await this.prisma.$transaction(async (tx) => {
      await tx.usuario_serie.deleteMany({ where: { serie_id: id } });
      if (ids.length) await tx.usuario_serie.createMany({ data: ids.map((usuario_id) => ({ usuario_id, serie_id: id })) });
      await this.auditoria.registrar(tx, {
        accion: 'serie.asignar',
        tabla: 'serie',
        registroId: id,
        antes: { usuarios: serie.usuario_serie.map((u) => u.usuario.id) },
        despues: { usuarios: ids },
      });
      return tx.serie.findUniqueOrThrow({ where: { id }, include: INCLUIR });
    });
    return vista(despues);
  }

  /**
   * La serie con la que el usuario emitiría un comprobante del tipo (D4). Con `tx`, se usa dentro de la emisión;
   * el número lo reserva después `sp_siguiente_correlativo` con la fila bloqueada.
   */
  async paraEmitir(sucursalId: number, usuarioId: number, tipo: TipoSerie, pedida?: number, tx: Prisma.TransactionClient = this.prisma) {
    const candidatas = await tx.serie.findMany({
      where: { sucursal_id: sucursalId, activo: true, es_contingencia: false, tipo_comprobante: { codigo: tipo } },
      select: { id: true, serie: true, correlativo_actual: true, usuario_serie: { select: { usuario_id: true } } },
    });
    try {
      const s = elegirSerie(candidatas.map((c) => ({ id: c.id, serie: c.serie, usuarios: c.usuario_serie.map((u) => u.usuario_id) })), usuarioId, tipo, pedida);
      const fila = candidatas.find((c) => c.id === s.id)!;
      return { id: s.id, serie: s.serie, siguiente: `${s.serie}-${String(fila.correlativo_actual + 1).padStart(8, '0')}` };
    } catch (e) {
      if (e instanceof ReglaSerieError) throw new ConflictException(e.message);
      throw e;
    }
  }
}
