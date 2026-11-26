import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { armarComprobante, EstructuraComprobanteError } from '../../facturacion/domain/comprobante';

/** Lectura de comprobantes emitidos para verlos e imprimirlos (el envío a SUNAT es de la fase F3). */
@Injectable()
export class ComprobantesService {
  constructor(private readonly prisma: PrismaService) {}

  async detalle(sucursalId: number, id: number) {
    const c = await this.prisma.comprobante.findFirst({
      where: { id: BigInt(id), sucursal_id: sucursalId },
      include: {
        tipo_comprobante: true,
        comprobante_detalle: { orderBy: { item: 'asc' } },
        comprobante_pago: { include: { metodo_pago: true } },
        sucursal: { include: { empresa: true } },
        usuario: { select: { nombres: true, apellidos: true } },
        reserva: { select: { codigo: true } },
      },
    });
    if (!c) throw new NotFoundException('El comprobante no existe en tu sucursal');
    const e = c.sucursal.empresa;
    return {
      id: Number(c.id),
      tipo: c.tipo_comprobante.codigo,
      tipoDescripcion: c.tipo_comprobante.descripcion,
      numero: `${c.serie}-${String(c.numero).padStart(8, '0')}`,
      fecha: c.fecha_emision.toISOString().slice(0, 10),
      hora: c.hora_emision.toISOString().slice(11, 19),
      emisor: { ruc: e.ruc, razonSocial: e.razon_social, nombreComercial: e.nombre_comercial, direccion: c.sucursal.direccion ?? e.direccion_fiscal, sucursal: c.sucursal.nombre },
      cliente: { tipoDoc: c.cliente_tipo_doc, documento: c.cliente_num_doc, nombre: c.cliente_nombre, direccion: c.cliente_direccion },
      lineas: c.comprobante_detalle.map((d) => ({ item: d.item, descripcion: d.descripcion, cantidad: Number(d.cantidad), precio: d.precio_unitario.toFixed(2), total: d.total.toFixed(2) })),
      gravada: c.total_gravada.toFixed(2),
      igv: c.total_igv.toFixed(2),
      // Descuento global con IGV (base + IGV), tal como lo ve el huésped
      descuento: c.descuento_global.add(c.descuento_igv).toFixed(2),
      descuentoMotivo: c.descuento_motivo,
      total: c.total.toFixed(2),
      letras: c.monto_letras,
      pagos: c.comprobante_pago.map((p) => ({ metodo: p.metodo_pago.descripcion, monto: p.monto.toFixed(2), referencia: p.referencia })),
      estadoSunat: c.estado_sunat,
      reserva: c.reserva?.codigo ?? null,
      cajero: `${c.usuario.nombres} ${c.usuario.apellidos}`,
    };
  }

  /** Convierte el comprobante a la estructura del proveedor y verifica que cuadre. */
  async estructura(sucursalId: number, id: number) {
    const c = await this.prisma.comprobante.findFirst({
      where: { id: BigInt(id), sucursal_id: sucursalId },
      include: {
        tipo_comprobante: true,
        moneda: true,
        sucursal: { include: { empresa: true } },
        comprobante_detalle: { orderBy: { item: 'asc' }, include: { tipo_afectacion_igv: true } },
      },
    });
    if (!c) throw new NotFoundException('El comprobante no existe en tu sucursal');
    try {
      return armarComprobante({
        rucEmisor: c.sucursal.empresa.ruc,
        tipo: c.tipo_comprobante.codigo,
        serie: c.serie,
        numero: c.numero,
        fechaEmision: c.fecha_emision.toISOString().slice(0, 10),
        moneda: c.moneda.codigo_iso as 'PEN' | 'USD',
        cliente: { tipoDocumento: c.cliente_tipo_doc, numeroDocumento: c.cliente_num_doc, nombre: c.cliente_nombre, direccion: c.cliente_direccion },
        lineas: c.comprobante_detalle.map((d) => ({
          descripcion: d.descripcion,
          cantidad: Number(d.cantidad),
          valorUnitario: Number(d.valor_unitario),
          precioUnitario: Number(d.precio_unitario),
          valorVenta: Number(d.valor_venta),
          igv: Number(d.igv),
          total: Number(d.total),
          afectacionIgv: d.tipo_afectacion_igv.codigo_sunat,
        })),
        totales: {
          gravada: Number(c.total_gravada),
          exonerada: Number(c.total_exonerada),
          inafecta: Number(c.total_inafecta),
          igv: Number(c.total_igv),
          descuentoBase: Number(c.descuento_global),
          descuentoIgv: Number(c.descuento_igv),
          total: Number(c.total),
        },
      });
    } catch (e) {
      if (e instanceof EstructuraComprobanteError) throw new ConflictException(e.message);
      throw e;
    }
  }

  async listar(sucursalId: number, fecha: string) {
    const filas = await this.prisma.comprobante.findMany({
      where: { sucursal_id: sucursalId, fecha_emision: new Date(`${fecha}T00:00:00Z`) },
      orderBy: { id: 'desc' },
      include: { tipo_comprobante: { select: { codigo: true } } },
    });
    return filas.map((c) => ({ id: Number(c.id), tipo: c.tipo_comprobante.codigo, numero: `${c.serie}-${String(c.numero).padStart(8, '0')}`, cliente: c.cliente_nombre, total: c.total.toFixed(2), estadoSunat: c.estado_sunat, hora: c.hora_emision.toISOString().slice(11, 16) }));
  }
}
