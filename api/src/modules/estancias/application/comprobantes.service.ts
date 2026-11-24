import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

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
      total: c.total.toFixed(2),
      letras: c.monto_letras,
      pagos: c.comprobante_pago.map((p) => ({ metodo: p.metodo_pago.descripcion, monto: p.monto.toFixed(2), referencia: p.referencia })),
      estadoSunat: c.estado_sunat,
      reserva: c.reserva?.codigo ?? null,
      cajero: `${c.usuario.nombres} ${c.usuario.apellidos}`,
    };
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
