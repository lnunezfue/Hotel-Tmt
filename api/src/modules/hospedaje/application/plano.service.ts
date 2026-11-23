import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { alertaSalida } from '../domain/estado-habitacion';
import { codigoAmenidad, esIconoAmenidad } from '../domain/amenidad';
import { distribucionInicial, PiezaPlano, Rect, ReglaPlanoError, ubicarPendientes, validarPlano } from '../domain/plano';
import { AvisosTablero } from './avisos-tablero.service';
import { ContextoSucursal } from './configuracion.service';

export type TipoElemento = 'PASILLO' | 'ESCALERA' | 'ASCENSOR' | 'RECEPCION' | 'AREA_COMUN' | 'BANO_COMUN';

export interface PlanoPisoEntrada {
  columnas: number;
  filas: number;
  habitaciones: Array<{ id: number } & Rect>;
  elementos: Array<{ tipo: TipoElemento; etiqueta?: string | null } & Rect>;
}

const NOMBRE_ELEMENTO: Record<TipoElemento, string> = {
  PASILLO: 'el pasillo',
  ESCALERA: 'la escalera',
  ASCENSOR: 'el ascensor',
  RECEPCION: 'la recepción',
  AREA_COMUN: 'el área común',
  BANO_COMUN: 'el baño común',
};

function traducir(e: unknown, duplicado = 'Ya existe'): never {
  if (e instanceof ReglaPlanoError) throw new BadRequestException(e.message);
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(duplicado);
  throw e;
}

/**
 * Plano visual del hotel y comodidades por habitación (spec S-06 §4). El plano es la misma información del
 * tablero dibujada por piso: posición de cada habitación, elementos del piso, estado y huésped actual.
 */
@Injectable()
export class PlanoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
    private readonly avisos: AvisosTablero,
  ) {}

  /** Todos los pisos activos de la sucursal con su plano. Las habitaciones sin posición se proponen en un hueco libre. */
  async plano(c: ContextoSucursal) {
    const ahora = new Date();
    const pisos = await this.prisma.piso.findMany({
      where: { sucursal_id: c.sucursalId, activo: true },
      orderBy: { numero: 'asc' },
      include: {
        plano_elemento: { orderBy: { id: 'asc' } },
        habitacion: {
          where: { activo: true },
          orderBy: { numero: 'asc' },
          include: {
            tipo_habitacion: { select: { id: true, nombre: true, capacidad_adultos: true, capacidad_ninos: true } },
            estado_habitacion: { select: { codigo: true } },
            habitacion_amenidad: { include: { amenidad: { select: { codigo: true } } } },
            estancia: {
              where: { estado: 'ACTIVA' },
              take: 1,
              include: { estancia_huesped: { where: { es_titular: true }, include: { cliente: { select: { nombre_completo: true, razon_social: true } } } } },
            },
          },
        },
      },
    });

    return pisos.map((p) => {
      const elementos = p.plano_elemento.map((e) => ({ id: e.id, tipo: e.tipo, etiqueta: e.etiqueta, x: e.x, y: e.y, ancho: e.ancho, alto: e.alto }));
      const ubicadas = p.habitacion.filter((h) => h.plano_x !== null && h.plano_y !== null);
      const ocupados: Rect[] = [...elementos, ...ubicadas.map((h) => ({ x: h.plano_x!, y: h.plano_y!, ancho: h.plano_ancho, alto: h.plano_alto }))];
      const pendientes = p.habitacion.filter((h) => h.plano_x === null || h.plano_y === null);
      const prop = ubicarPendientes(p.plano_columnas, p.plano_filas, ocupados, pendientes.map((h) => ({ id: h.id, ancho: h.plano_ancho, alto: h.plano_alto })));

      return {
        id: p.id,
        numero: p.numero,
        nombre: p.nombre,
        columnas: p.plano_columnas,
        filas: Math.max(p.plano_filas, prop.filas),
        elementos,
        habitaciones: p.habitacion.map((h) => {
          const propuesta = prop.posiciones.get(h.id);
          const pos = h.plano_x !== null && h.plano_y !== null ? { x: h.plano_x, y: h.plano_y } : propuesta ?? { x: 0, y: 0 };
          const est = h.estancia[0];
          const titular = est?.estancia_huesped[0]?.cliente;
          return {
            id: h.id,
            numero: h.numero,
            descripcion: h.descripcion,
            estado: h.estado_habitacion.codigo,
            tipo: { id: h.tipo_habitacion.id, nombre: h.tipo_habitacion.nombre, adultos: h.tipo_habitacion.capacidad_adultos, ninos: h.tipo_habitacion.capacidad_ninos },
            amenidades: h.habitacion_amenidad.map((a) => a.amenidad.codigo),
            ...pos,
            ancho: h.plano_ancho,
            alto: h.plano_alto,
            ubicada: h.plano_x !== null,
            estancia: est
              ? { huesped: titular?.nombre_completo ?? titular?.razon_social ?? null, salidaPrevista: est.checkout_previsto, alerta: alertaSalida(est.checkout_previsto, ahora) }
              : null,
          };
        }),
      };
    });
  }

  /** Guarda posiciones y elementos de un piso de una vez; valida límites y superposiciones (D2). */
  async guardarPiso(c: ContextoSucursal, pisoId: number, d: PlanoPisoEntrada) {
    const piso = await this.prisma.piso.findFirst({
      where: { id: pisoId, sucursal_id: c.sucursalId },
      include: { habitacion: { where: { activo: true }, select: { id: true, numero: true, plano_x: true, plano_y: true, plano_ancho: true, plano_alto: true } }, plano_elemento: true },
    });
    if (!piso) throw new NotFoundException('El piso no existe en tu sucursal');

    const propias = new Map(piso.habitacion.map((h) => [h.id, h]));
    const ajenas = d.habitaciones.filter((h) => !propias.has(h.id));
    if (ajenas.length) throw new BadRequestException('Hay habitaciones que no pertenecen a este piso');
    const piezas: PiezaPlano[] = [
      ...d.habitaciones.map((h) => ({ x: h.x, y: h.y, ancho: h.ancho, alto: h.alto, nombre: `habitación ${propias.get(h.id)!.numero}` })),
      ...d.elementos.map((e) => ({ x: e.x, y: e.y, ancho: e.ancho, alto: e.alto, nombre: e.etiqueta ? `«${e.etiqueta}»` : NOMBRE_ELEMENTO[e.tipo] })),
    ];
    try {
      validarPlano(d.columnas, d.filas, piezas);
    } catch (e) {
      traducir(e);
    }

    const antes = {
      columnas: piso.plano_columnas,
      filas: piso.plano_filas,
      habitaciones: piso.habitacion.map((h) => ({ id: h.id, x: h.plano_x, y: h.plano_y, ancho: h.plano_ancho, alto: h.plano_alto })),
      elementos: piso.plano_elemento.map(({ tipo, etiqueta, x, y, ancho, alto }) => ({ tipo, etiqueta, x, y, ancho, alto })),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.piso.update({ where: { id: pisoId }, data: { plano_columnas: d.columnas, plano_filas: d.filas } });
      for (const h of d.habitaciones) {
        await tx.habitacion.update({ where: { id: h.id }, data: { plano_x: h.x, plano_y: h.y, plano_ancho: h.ancho, plano_alto: h.alto } });
      }
      await tx.plano_elemento.deleteMany({ where: { piso_id: pisoId } });
      if (d.elementos.length) {
        await tx.plano_elemento.createMany({
          data: d.elementos.map((e) => ({ piso_id: pisoId, tipo: e.tipo, etiqueta: e.etiqueta?.trim() || null, x: e.x, y: e.y, ancho: e.ancho, alto: e.alto })),
        });
      }
      await this.auditoria.registrar(tx, { accion: 'plano.guardar', tabla: 'piso', registroId: pisoId, antes, despues: d });
    });
    await this.avisos.avisar(c.sucursalId, 'piso');
    return { pisoId, habitaciones: d.habitaciones.length, elementos: d.elementos.length };
  }

  /**
   * Piso nuevo con su plano de partida: pasillo y escalera, y si se piden habitaciones, una fila arriba y otra
   * abajo del pasillo numeradas como el piso (401, 402...). Es el "agregar un piso al hotel" del editor.
   */
  async crearPisoConPlano(c: ContextoSucursal, d: { numero: number; nombre: string; habitaciones: number; tipoHabitacionId?: number }) {
    if (d.habitaciones > 0 && !d.tipoHabitacionId) throw new BadRequestException('Elige el tipo de las habitaciones nuevas');
    if (d.tipoHabitacionId) {
      const tipo = await this.prisma.tipo_habitacion.findFirst({ where: { id: d.tipoHabitacionId, empresa_id: c.empresaId, activo: true } });
      if (!tipo) throw new BadRequestException('El tipo de habitación no existe o está inactivo');
    }
    const plan = distribucionInicial(d.habitaciones);
    // Las habitaciones nuevas salen equipadas como las demás de su tipo en la sucursal (se cambia luego por habitación)
    const modelo = d.tipoHabitacionId
      ? await this.prisma.habitacion.findFirst({
          where: { sucursal_id: c.sucursalId, tipo_habitacion_id: d.tipoHabitacionId, activo: true, habitacion_amenidad: { some: {} } },
          orderBy: { id: 'asc' },
          include: { habitacion_amenidad: true },
        })
      : null;
    const equipamiento = modelo?.habitacion_amenidad.map((a) => ({ amenidad_id: a.amenidad_id })) ?? [];
    const desocupada = await this.prisma.estado_habitacion.findUniqueOrThrow({ where: { codigo: 'DESOCUPADA' } });
    try {
      const creado = await this.prisma.$transaction(async (tx) => {
        const piso = await tx.piso.create({
          data: { sucursal_id: c.sucursalId, numero: d.numero, nombre: d.nombre.trim(), plano_columnas: plan.columnas, plano_filas: plan.filas },
        });
        await tx.plano_elemento.createMany({
          data: [
            { piso_id: piso.id, tipo: 'PASILLO', etiqueta: null, ...plan.pasillo },
            { piso_id: piso.id, tipo: 'ESCALERA', etiqueta: null, ...plan.escalera },
          ],
        });
        const numeros: string[] = [];
        for (const [i, r] of plan.habitaciones.entries()) {
          const numero = `${d.numero}${String(i + 1).padStart(2, '0')}`;
          const hab = await tx.habitacion.create({
            data: {
              sucursal_id: c.sucursalId, piso_id: piso.id, tipo_habitacion_id: d.tipoHabitacionId!, estado_habitacion_id: desocupada.id,
              numero, plano_x: r.x, plano_y: r.y, plano_ancho: r.ancho, plano_alto: r.alto,
              habitacion_amenidad: { create: equipamiento },
            },
          });
          await this.auditoria.registrar(tx, { accion: 'habitacion.crear', tabla: 'habitacion', registroId: hab.id, despues: hab });
          numeros.push(numero);
        }
        await this.auditoria.registrar(tx, { accion: 'piso.crear', tabla: 'piso', registroId: piso.id, despues: { ...piso, habitaciones: numeros } });
        return { ...piso, habitaciones: numeros };
      });
      await this.avisos.avisar(c.sucursalId, 'piso');
      return creado;
    } catch (e) {
      traducir(e, `Ya existe el piso ${d.numero} o alguna de sus habitaciones en esta sucursal`);
    }
  }

  // ── Comodidades ───────────────────────────────────────────────

  async amenidades(c: ContextoSucursal) {
    const filas = await this.prisma.amenidad.findMany({
      where: { empresa_id: c.empresaId },
      orderBy: [{ orden: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { habitacion_amenidad: { where: { habitacion: { sucursal_id: c.sucursalId, activo: true } } } } } },
    });
    return filas.map((a) => ({ id: a.id, codigo: a.codigo, nombre: a.nombre, icono: a.icono, activo: a.activo, habitaciones: a._count.habitacion_amenidad }));
  }

  async crearAmenidad(c: ContextoSucursal, d: { nombre: string; icono: string }) {
    if (!esIconoAmenidad(d.icono)) throw new BadRequestException('Dibujo no válido para la comodidad');
    const codigo = codigoAmenidad(d.nombre);
    if (codigo.length < 2) throw new BadRequestException('Escribe un nombre para la comodidad');
    const ultimo = await this.prisma.amenidad.aggregate({ where: { empresa_id: c.empresaId }, _max: { orden: true } });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const a = await tx.amenidad.create({ data: { empresa_id: c.empresaId, codigo, nombre: d.nombre.trim(), icono: d.icono, orden: Math.min(255, (ultimo._max.orden ?? 0) + 1) } });
        await this.auditoria.registrar(tx, { accion: 'amenidad.crear', tabla: 'amenidad', registroId: a.id, despues: a });
        return a;
      });
    } catch (e) {
      traducir(e, `Ya existe la comodidad «${d.nombre.trim()}»`);
    }
  }

  async editarAmenidad(c: ContextoSucursal, id: number, d: { nombre?: string; icono?: string; activo?: boolean }) {
    const antes = await this.prisma.amenidad.findFirst({ where: { id, empresa_id: c.empresaId } });
    if (!antes) throw new NotFoundException('La comodidad no existe');
    if (d.icono !== undefined && !esIconoAmenidad(d.icono)) throw new BadRequestException('Dibujo no válido para la comodidad');
    return this.prisma.$transaction(async (tx) => {
      const despues = await tx.amenidad.update({ where: { id }, data: { ...(d.nombre !== undefined && { nombre: d.nombre.trim() }), ...(d.icono !== undefined && { icono: d.icono }), ...(d.activo !== undefined && { activo: d.activo }) } });
      await this.auditoria.registrar(tx, { accion: 'amenidad.editar', tabla: 'amenidad', registroId: id, antes, despues });
      return despues;
    });
  }

  /**
   * Reemplaza las comodidades de una habitación. Con `aplicarATipo`, también a todas las habitaciones activas
   * del mismo tipo en la sucursal (equipar de una vez todas las "Doble").
   */
  async asignarAmenidades(c: ContextoSucursal, habitacionId: number, codigos: string[], aplicarATipo = false) {
    const hab = await this.prisma.habitacion.findFirst({
      where: { id: habitacionId, sucursal_id: c.sucursalId },
      include: { habitacion_amenidad: { include: { amenidad: { select: { codigo: true } } } } },
    });
    if (!hab) throw new NotFoundException('La habitación no existe en tu sucursal');
    const unicos = [...new Set(codigos)];
    const catalogo = await this.prisma.amenidad.findMany({ where: { empresa_id: c.empresaId, codigo: { in: unicos }, activo: true } });
    if (catalogo.length !== unicos.length) throw new BadRequestException('Hay comodidades desconocidas o inactivas');
    const destino = aplicarATipo
      ? (await this.prisma.habitacion.findMany({ where: { sucursal_id: c.sucursalId, tipo_habitacion_id: hab.tipo_habitacion_id, activo: true }, select: { id: true } })).map((h) => h.id)
      : [habitacionId];

    await this.prisma.$transaction(async (tx) => {
      await tx.habitacion_amenidad.deleteMany({ where: { habitacion_id: { in: destino } } });
      await tx.habitacion_amenidad.createMany({ data: destino.flatMap((id) => catalogo.map((a) => ({ habitacion_id: id, amenidad_id: a.id }))) });
      await this.auditoria.registrar(tx, {
        accion: 'habitacion.amenidades',
        tabla: 'habitacion',
        registroId: habitacionId,
        antes: { amenidades: hab.habitacion_amenidad.map((a) => a.amenidad.codigo).sort() },
        despues: { amenidades: unicos.sort(), habitaciones: destino },
      });
    });
    await this.avisos.avisar(c.sucursalId, 'habitacion');
    return { habitaciones: destino.length, amenidades: unicos };
  }
}
