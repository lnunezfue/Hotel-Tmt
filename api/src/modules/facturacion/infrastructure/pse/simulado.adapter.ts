import { Injectable } from '@nestjs/common';
import { ComprobanteAEmitir, ProveedorFacturacion, RespuestaProveedor, TipoCpe } from '../../domain/proveedor-facturacion.port';

/** Adaptador simulado para desarrollo y pruebas (entorno «Desarrollo» del DT-001 §5.2). No contacta a SUNAT. */
@Injectable()
export class SimuladoAdapter implements ProveedorFacturacion {
  readonly nombre = 'simulado';

  async emitir(c: ComprobanteAEmitir): Promise<RespuestaProveedor> {
    return { aceptado: true, estado: 'ACEPTADO', codigoSunat: '0', descripcion: `La ${c.tipo} ${c.serie}-${c.numero} ha sido aceptada (simulado)`, hash: 'SIMULADO' };
  }

  async consultarEstado(tipo: TipoCpe, serie: string, numero: number): Promise<RespuestaProveedor> {
    return { aceptado: true, estado: 'ACEPTADO', codigoSunat: '0', descripcion: `${tipo} ${serie}-${numero} aceptada (simulado)` };
  }

  async comunicarBaja(tipo: TipoCpe, serie: string, numero: number): Promise<RespuestaProveedor> {
    return { aceptado: true, estado: 'ACEPTADO', descripcion: `Baja de ${tipo} ${serie}-${numero} aceptada (simulado)` };
  }
}
