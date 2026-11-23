import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
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

  private vista(c: { id: bigint; numero_documento: string; nombre_completo: string | null; razon_social: string | null; telefono: string | null; pais_codigo: string; tipo_documento: { abreviatura: string } }) {
    return { id: Number(c.id), documento: `${c.tipo_documento.abreviatura} ${c.numero_documento}`, nombre: c.nombre_completo ?? c.razon_social ?? '', telefono: c.telefono, pais: c.pais_codigo };
  }
}
