import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import { ReglaReservaError, validarDocumento } from '../domain/reserva';

export interface NuevoCliente {
  tipoDocumentoId: number;
  numeroDocumento: string;
  nombres?: string | null;
  apellidos?: string | null;
  razonSocial?: string | null;
  pais?: string;
  telefono?: string | null;
  email?: string | null;
}

/** Huéspedes y clientes de la empresa: búsqueda por documento o nombre y alta rápida desde la reserva. */
@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  tiposDocumento() {
    return this.prisma.tipo_documento_identidad.findMany({ where: { activo: true, codigo_sunat: { not: '0' } }, select: { id: true, abreviatura: true, descripcion: true }, orderBy: { id: 'asc' } });
  }

  async buscar(empresaId: number, q: string) {
    const t = q.trim();
    if (t.length < 2) return [];
    const filas = await this.prisma.cliente.findMany({
      where: {
        empresa_id: empresaId,
        activo: true,
        OR: [{ numero_documento: { startsWith: t } }, { nombre_completo: { contains: t } }, { razon_social: { contains: t } }],
      },
      take: 8,
      orderBy: { updated_at: 'desc' },
      include: { tipo_documento: { select: { abreviatura: true } } },
    });
    return filas.map((c) => this.vista(c));
  }

  async crear(empresaId: number, d: NuevoCliente) {
    const tipo = await this.prisma.tipo_documento_identidad.findUnique({ where: { id: d.tipoDocumentoId } });
    if (!tipo) throw new BadRequestException('Tipo de documento no válido');
    let numero: string;
    try {
      numero = validarDocumento(tipo.abreviatura === 'PAS' ? 'PASAPORTE' : tipo.abreviatura, d.numeroDocumento);
    } catch (e) {
      if (e instanceof ReglaReservaError) throw new BadRequestException(e.message);
      throw e;
    }
    const esEmpresa = tipo.abreviatura === 'RUC' && numero.startsWith('20');
    if (esEmpresa ? !d.razonSocial?.trim() : !d.nombres?.trim() || !d.apellidos?.trim()) {
      throw new BadRequestException(esEmpresa ? 'Escribe la razón social' : 'Escribe nombres y apellidos');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const c = await tx.cliente.create({
          data: {
            empresa_id: empresaId, tipo_documento_id: tipo.id, numero_documento: numero,
            nombres: esEmpresa ? null : d.nombres!.trim(), apellidos: esEmpresa ? null : d.apellidos!.trim(),
            razon_social: esEmpresa ? d.razonSocial!.trim() : null, pais_codigo: (d.pais ?? 'PE').toUpperCase(),
            telefono: d.telefono?.trim() || null, email: d.email?.trim() || null,
          },
          include: { tipo_documento: { select: { abreviatura: true } } },
        });
        await this.auditoria.registrar(tx, { accion: 'cliente.crear', tabla: 'cliente', registroId: c.id, despues: { documento: `${tipo.abreviatura} ${numero}` } });
        return this.vista(c);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Ya hay un cliente con ${tipo.abreviatura} ${numero}`);
      throw e;
    }
  }

  /** Lista de la pantalla Clientes: los últimos movidos o los que coinciden con la búsqueda. */
  async cartera(empresaId: number, q: string, incluirInactivos: boolean) {
    const t = q.trim();
    const filas = await this.prisma.cliente.findMany({
      where: {
        empresa_id: empresaId,
        ...(!incluirInactivos && { activo: true }),
        ...(t && { OR: [{ numero_documento: { startsWith: t.toUpperCase() } }, { nombre_completo: { contains: t } }, { razon_social: { contains: t } }] }),
      },
      take: 50,
      orderBy: t ? { nombre_completo: 'asc' } : { updated_at: 'desc' },
      include: { tipo_documento: { select: { abreviatura: true } } },
    });
    return filas.map((c) => ({ ...this.vista(c), email: c.email, activo: c.activo }));
  }

  async detalle(empresaId: number, id: number) {
    const c = await this.prisma.cliente.findFirst({ where: { id, empresa_id: empresaId }, include: { tipo_documento: true, pais: true } });
    if (!c) throw new NotFoundException('El cliente no existe');
    return {
      ...this.vista(c),
      tipoDocumentoId: c.tipo_documento_id,
      numeroDocumento: c.numero_documento,
      nombres: c.nombres,
      apellidos: c.apellidos,
      razonSocial: c.razon_social,
      paisNombre: c.pais.nombre,
      direccion: c.direccion,
      fechaNacimiento: c.fecha_nacimiento ? c.fecha_nacimiento.toISOString().slice(0, 10) : null,
      sexo: c.sexo,
      email: c.email,
      observaciones: c.observaciones,
      activo: c.activo,
    };
  }

  /**
   * Edita los datos del cliente. El documento no cambia si ya tiene reservas, estancias o comprobantes: esos
   * registros lo citan y cambiarlo los falsearía (se registra un cliente nuevo).
   */
  async editar(
    empresaId: number,
    id: number,
    d: Partial<NuevoCliente> & { direccion?: string | null; fechaNacimiento?: string | null; sexo?: 'M' | 'F' | 'X' | null; observaciones?: string | null; activo?: boolean },
  ) {
    const antes = await this.prisma.cliente.findFirst({ where: { id, empresa_id: empresaId }, include: { tipo_documento: true } });
    if (!antes) throw new NotFoundException('El cliente no existe');
    const tipo = d.tipoDocumentoId ? await this.prisma.tipo_documento_identidad.findUnique({ where: { id: d.tipoDocumentoId } }) : antes.tipo_documento;
    if (!tipo) throw new BadRequestException('Tipo de documento no válido');
    let numero = antes.numero_documento;
    try {
      if (d.numeroDocumento !== undefined || d.tipoDocumentoId !== undefined) {
        numero = validarDocumento(tipo.abreviatura === 'PAS' ? 'PASAPORTE' : tipo.abreviatura, d.numeroDocumento ?? antes.numero_documento);
      }
    } catch (e) {
      if (e instanceof ReglaReservaError) throw new BadRequestException(e.message);
      throw e;
    }
    const cambiaDocumento = tipo.id !== antes.tipo_documento_id || numero !== antes.numero_documento;
    if (cambiaDocumento) {
      const [reservas, estancias, comprobantes] = await Promise.all([
        this.prisma.reserva.count({ where: { cliente_id: antes.id } }),
        this.prisma.estancia_huesped.count({ where: { cliente_id: antes.id } }),
        this.prisma.comprobante.count({ where: { cliente_id: antes.id } }),
      ]);
      if (reservas + estancias + comprobantes > 0) {
        throw new ConflictException('El cliente ya tiene reservas, estadías o comprobantes: su documento no se cambia. Registra un cliente nuevo.');
      }
    }
    const esEmpresa = tipo.abreviatura === 'RUC' && numero.startsWith('20');
    const nombres = d.nombres !== undefined ? d.nombres?.trim() || null : antes.nombres;
    const apellidos = d.apellidos !== undefined ? d.apellidos?.trim() || null : antes.apellidos;
    const razonSocial = d.razonSocial !== undefined ? d.razonSocial?.trim() || null : antes.razon_social;
    if (esEmpresa ? !razonSocial : !nombres || !apellidos) throw new BadRequestException(esEmpresa ? 'Escribe la razón social' : 'Escribe nombres y apellidos');
    if (d.fechaNacimiento && (d.fechaNacimiento >= new Date().toISOString().slice(0, 10) || d.fechaNacimiento < '1900-01-01')) {
      throw new BadRequestException('La fecha de nacimiento no es válida');
    }
    const opcional = (v: string | null | undefined, previo: string | null) => (v !== undefined ? v?.trim() || null : previo);
    try {
      await this.prisma.$transaction(async (tx) => {
        const despues = await tx.cliente.update({
          where: { id: antes.id },
          data: {
            tipo_documento_id: tipo.id,
            numero_documento: numero,
            nombres: esEmpresa ? null : nombres,
            apellidos: esEmpresa ? null : apellidos,
            razon_social: esEmpresa ? razonSocial : null,
            pais_codigo: (d.pais ?? antes.pais_codigo).toUpperCase(),
            telefono: opcional(d.telefono, antes.telefono),
            email: opcional(d.email, antes.email),
            direccion: opcional(d.direccion, antes.direccion),
            fecha_nacimiento: d.fechaNacimiento !== undefined ? (d.fechaNacimiento ? new Date(`${d.fechaNacimiento}T00:00:00Z`) : null) : antes.fecha_nacimiento,
            sexo: d.sexo !== undefined ? d.sexo : antes.sexo,
            observaciones: opcional(d.observaciones, antes.observaciones),
            ...(d.activo !== undefined && { activo: d.activo }),
          },
        });
        const { tipo_documento: _t, ...datosAntes } = antes;
        await this.auditoria.registrar(tx, { accion: 'cliente.editar', tabla: 'cliente', registroId: antes.id, antes: datosAntes, despues });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Ya hay un cliente con ${tipo.abreviatura} ${numero}`);
      throw e;
    }
    return this.detalle(empresaId, id);
  }

  private vista(c: { id: bigint; numero_documento: string; nombre_completo: string | null; razon_social: string | null; telefono: string | null; pais_codigo: string; tipo_documento: { abreviatura: string } }) {
    return { id: Number(c.id), documento: `${c.tipo_documento.abreviatura} ${c.numero_documento}`, nombre: c.nombre_completo ?? c.razon_social ?? '', telefono: c.telefono, pais: c.pais_codigo };
  }
}
