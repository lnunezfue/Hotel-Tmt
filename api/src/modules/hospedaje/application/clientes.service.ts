import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditoriaService } from '../../auditoria/application/auditoria.service';
import {
  CodigoDocumento,
  esCodigoDocumento,
  esPersona,
  normalizarDocumento,
  normalizarEmail,
  normalizarNombre,
  normalizarTelefono,
  ReglaClienteError,
} from '../domain/cliente';
import { esFecha, fechaADb, fechaDeDb, hoyLima } from '../domain/tarifa';
import { traducirReglas } from './disponibilidad';

export interface DatosCliente {
  tipoDocumento: string;
  numeroDocumento: string;
  razonSocial?: string | null;
  nombres?: string | null;
  apellidos?: string | null;
  paisCodigo?: string;
  direccion?: string | null;
  fechaNacimiento?: string | null;
  sexo?: 'M' | 'F' | 'X' | null;
  telefono?: string | null;
  email?: string | null;
  observaciones?: string | null;
}

const INCLUIR = { tipo_documento: { select: { codigo_sunat: true, abreviatura: true } }, pais: { select: { nombre: true } } } as const;
type FilaCliente = Prisma.clienteGetPayload<{ include: typeof INCLUIR }>;

/** Forma pública del cliente. */
export function comoCliente(c: FilaCliente) {
  const tipo = c.tipo_documento.codigo_sunat as CodigoDocumento;
  return {
    id: Number(c.id),
    tipoDocumento: tipo,
    tipoDocumentoAbrev: c.tipo_documento.abreviatura,
    numeroDocumento: c.numero_documento,
    razonSocial: c.razon_social,
    nombres: c.nombres,
    apellidos: c.apellidos,
    nombreCompleto: c.nombre_completo ?? '',
    esPersona: esPersona(tipo),
    paisCodigo: c.pais_codigo,
    pais: c.pais.nombre,
    direccion: c.direccion,
    fechaNacimiento: c.fecha_nacimiento ? fechaDeDb(c.fecha_nacimiento) : null,
    sexo: c.sexo,
    telefono: c.telefono,
    email: c.email,
    observaciones: c.observaciones,
    activo: c.activo,
  };
}

const texto = (v: string | null | undefined, max: number, campo: string): string | null => {
  const t = v?.trim();
  if (!t) return null;
  if (t.length > max) throw new ReglaClienteError(`${campo} admite hasta ${max} caracteres`);
  return t;
};

/** Cartera de clientes de la empresa (RF-RES-17). El mismo registro sirve de titular, huésped y, luego, de cliente a facturar. */
@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async buscar(empresaId: number, q: string | undefined, incluirInactivos: boolean) {
    const termino = q?.trim();
    const filas = await this.prisma.cliente.findMany({
      where: {
        empresa_id: empresaId,
        ...(!incluirInactivos && { activo: true }),
        ...(termino && {
          OR: [{ numero_documento: { startsWith: termino.toUpperCase().replace(/\s+/g, '') } }, { nombre_completo: { contains: termino } }],
        }),
      },
      include: INCLUIR,
      orderBy: termino ? { nombre_completo: 'asc' } : { updated_at: 'desc' },
      take: 30,
    });
    return filas.map(comoCliente);
  }

  async obtener(empresaId: number, id: number) {
    const c = await this.prisma.cliente.findFirst({ where: { id, empresa_id: empresaId }, include: INCLUIR });
    if (!c) throw new NotFoundException('El cliente no existe');
    return comoCliente(c);
  }

  async crear(empresaId: number, d: DatosCliente) {
    try {
      const datos = await this.normalizar(d);
      return await this.prisma.$transaction(async (tx) => {
        const c = await tx.cliente.create({ data: { empresa_id: empresaId, ...datos }, include: INCLUIR });
        await this.auditoria.registrar(tx, { accion: 'cliente.crear', tabla: 'cliente', registroId: c.id, despues: c });
        return comoCliente(c);
      });
    } catch (e) {
      this.traducir(e);
    }
  }

  async editar(empresaId: number, id: number, d: Partial<DatosCliente> & { activo?: boolean }) {
    const antes = await this.prisma.cliente.findFirst({ where: { id, empresa_id: empresaId }, include: INCLUIR });
    if (!antes) throw new NotFoundException('El cliente no existe');
    const tipoAntes = antes.tipo_documento.codigo_sunat;
    const tipo = d.tipoDocumento ?? tipoAntes;
    try {
      const datos = await this.normalizar({
        tipoDocumento: tipo,
        numeroDocumento: d.numeroDocumento ?? antes.numero_documento,
        razonSocial: d.razonSocial !== undefined ? d.razonSocial : antes.razon_social,
        nombres: d.nombres !== undefined ? d.nombres : antes.nombres,
        apellidos: d.apellidos !== undefined ? d.apellidos : antes.apellidos,
        paisCodigo: d.paisCodigo ?? antes.pais_codigo,
        direccion: d.direccion !== undefined ? d.direccion : antes.direccion,
        fechaNacimiento: d.fechaNacimiento !== undefined ? d.fechaNacimiento : antes.fecha_nacimiento ? fechaDeDb(antes.fecha_nacimiento) : null,
        sexo: d.sexo !== undefined ? d.sexo : antes.sexo,
        telefono: d.telefono !== undefined ? d.telefono : antes.telefono,
        email: d.email !== undefined ? d.email : antes.email,
        observaciones: d.observaciones !== undefined ? d.observaciones : antes.observaciones,
      });
      const cambiaDocumento = datos.tipo_documento_id !== antes.tipo_documento_id || datos.numero_documento !== antes.numero_documento;
      if (cambiaDocumento) {
        const [reservas, estancias] = await Promise.all([
          this.prisma.reserva.count({ where: { cliente_id: id } }),
          this.prisma.estancia_huesped.count({ where: { cliente_id: id } }),
        ]);
        if (reservas + estancias > 0) {
          throw new ConflictException('El cliente ya tiene reservas o estancias: su documento no se cambia. Registra un cliente nuevo.');
        }
      }
      return await this.prisma.$transaction(async (tx) => {
        const despues = await tx.cliente.update({ where: { id }, data: { ...datos, ...(d.activo !== undefined && { activo: d.activo }) }, include: INCLUIR });
        await this.auditoria.registrar(tx, { accion: 'cliente.editar', tabla: 'cliente', registroId: id, antes, despues });
        return comoCliente(despues);
      });
    } catch (e) {
      this.traducir(e);
    }
  }

  private async normalizar(d: DatosCliente) {
    if (!esCodigoDocumento(d.tipoDocumento)) throw new ReglaClienteError('Tipo de documento desconocido');
    const tipo = d.tipoDocumento;
    const tdi = await this.prisma.tipo_documento_identidad.findFirst({ where: { codigo_sunat: tipo, activo: true } });
    if (!tdi) throw new ReglaClienteError('El tipo de documento no está disponible');
    const paisCodigo = (d.paisCodigo ?? 'PE').toUpperCase();
    if (!(await this.prisma.pais.findUnique({ where: { codigo: paisCodigo } }))) throw new ReglaClienteError(`País desconocido: ${paisCodigo}`);
    let fechaNacimiento: Date | null = null;
    if (d.fechaNacimiento) {
      if (!esFecha(d.fechaNacimiento) || d.fechaNacimiento >= hoyLima() || d.fechaNacimiento < '1900-01-01') {
        throw new ReglaClienteError('La fecha de nacimiento no es válida');
      }
      fechaNacimiento = fechaADb(d.fechaNacimiento);
    }
    const nombre = normalizarNombre(tipo, d);
    return {
      tipo_documento_id: tdi.id,
      numero_documento: normalizarDocumento(tipo, d.numeroDocumento),
      razon_social: nombre.razonSocial,
      nombres: nombre.nombres,
      apellidos: nombre.apellidos,
      pais_codigo: paisCodigo,
      direccion: texto(d.direccion, 250, 'La dirección'),
      fecha_nacimiento: fechaNacimiento,
      sexo: d.sexo ?? null,
      telefono: normalizarTelefono(d.telefono),
      email: normalizarEmail(d.email),
      observaciones: texto(d.observaciones, 500, 'Las observaciones'),
    };
  }

  private traducir(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Ya existe un cliente con ese documento');
    if (e instanceof BadRequestException || e instanceof ConflictException) throw e;
    traducirReglas(e);
  }
}
