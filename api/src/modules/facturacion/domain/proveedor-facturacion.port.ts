/**
 * Puerto del proveedor de facturación (DT-001 §4.4). El dominio solo conoce esta interfaz;
 * NubeFacT, FactuSmart o el Facturador SUNAT se implementan como adaptadores intercambiables.
 * Avance: contrato definido y adaptador simulado. La emisión real se implementa en la fase de facturación.
 */
export const PROVEEDOR_FACTURACION = Symbol('PROVEEDOR_FACTURACION');

export type TipoCpe = 'FACTURA' | 'BOLETA' | 'NOTA_CREDITO' | 'NOTA_DEBITO';

export interface ComprobanteAEmitir {
  tipo: TipoCpe;
  serie: string;
  numero: number;
  fechaEmision: string;
  moneda: 'PEN' | 'USD';
  cliente: { tipoDocumento: string; numeroDocumento: string; nombre: string; direccion?: string };
  items: Array<{ descripcion: string; cantidad: number; valorUnitario: number; precioUnitario: number; igv: number; total: number; afectacionIgv: string }>;
  totales: { gravada: number; exonerada: number; inafecta: number; igv: number; descuentoGlobal: number; total: number };
  claveIdempotencia: string;
}

export interface RespuestaProveedor {
  aceptado: boolean;
  estado: 'ACEPTADO' | 'OBSERVADO' | 'RECHAZADO' | 'PENDIENTE';
  codigoSunat?: string;
  descripcion?: string;
  hash?: string;
  xmlUrl?: string;
  cdrUrl?: string;
  pdfUrl?: string;
}

export interface ProveedorFacturacion {
  readonly nombre: string;
  emitir(c: ComprobanteAEmitir): Promise<RespuestaProveedor>;
  consultarEstado(tipo: TipoCpe, serie: string, numero: number): Promise<RespuestaProveedor>;
  comunicarBaja(tipo: TipoCpe, serie: string, numero: number, motivo: string): Promise<RespuestaProveedor>;
}
