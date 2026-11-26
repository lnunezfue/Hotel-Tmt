import { useQuery } from '@tanstack/react-query';
import { api, type Comprobante } from '../../lib/api';
import { soles } from '../hospedaje/formato';
import { fechaCorta } from '../hospedaje/formato';

const TIPO_DOC: Record<string, string> = { '0': 'SIN DOC.', '1': 'DNI', '4': 'C.E.', '6': 'RUC', '7': 'PASAPORTE' };
const SUNAT: Record<string, string> = {
  PENDIENTE: 'Pendiente de envío a SUNAT (se activa en la fase de facturación F3)',
  NO_APLICA: 'Comprobante interno: no se envía a SUNAT',
  ACEPTADO: 'Aceptado por SUNAT',
};

/** Comprobante con el formato de ticket de 80 mm que se entrega al huésped. */
export function VistaComprobante({ id, vuelto }: { id: number; vuelto?: string }) {
  const q = useQuery({ queryKey: ['comprobantes', id], queryFn: () => api<Comprobante>(`/comprobantes/${id}`) });
  const c = q.data;
  if (!c) return <p className="text-sm text-tinta-suave">{q.error?.message ?? 'Cargando comprobante…'}</p>;
  const electronica = c.tipo !== 'INTERNO';
  return (
    <div className="comprobante mx-auto w-full max-w-[340px] rounded-sm border border-borde bg-white p-5 font-mono text-[12px] leading-snug text-black shadow-sm">
      <div className="text-center">
        <div className="text-sm font-bold">{c.emisor.nombreComercial ?? c.emisor.razonSocial}</div>
        <div>{c.emisor.razonSocial}</div>
        <div>RUC {c.emisor.ruc}</div>
        {c.emisor.direccion && <div>{c.emisor.direccion}</div>}
        <div className="mt-2 border-y border-dashed border-black py-1 font-bold">
          {electronica ? `${c.tipo === 'FACTURA' ? 'FACTURA' : 'BOLETA DE VENTA'} ELECTRÓNICA` : 'NOTA DE VENTA INTERNA'}
          <div>{c.numero}</div>
        </div>
      </div>
      <div className="mt-2">
        <div>Fecha: {fechaCorta(c.fecha)} {c.hora.slice(0, 5)}</div>
        <div>Cliente: {c.cliente.nombre}</div>
        <div>{TIPO_DOC[c.cliente.tipoDoc] ?? 'DOC.'}: {c.cliente.documento}</div>
        {c.reserva && <div>Reserva: {c.reserva}</div>}
      </div>
      <div className="mt-2 border-t border-dashed border-black pt-1">
        {c.lineas.map((l) => (
          <div key={l.item} className="mb-1">
            <div>{l.descripcion}</div>
            <div className="flex justify-between"><span>{l.cantidad} x {Number(l.precio).toFixed(2)}</span><span>{Number(l.total).toFixed(2)}</span></div>
          </div>
        ))}
      </div>
      <div className="mt-1 border-t border-dashed border-black pt-1">
        {Number(c.descuento) > 0 && (
          <div className="flex justify-between"><span>DESCUENTO GLOBAL</span><span>-{soles(c.descuento)}</span></div>
        )}
        <div className="flex justify-between"><span>OP. GRAVADA</span><span>{soles(c.gravada)}</span></div>
        <div className="flex justify-between"><span>IGV 18%</span><span>{soles(c.igv)}</span></div>
        <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{soles(c.total)}</span></div>
        {c.letras && <div className="mt-1">SON: {c.letras}</div>}
        {c.descuentoMotivo && <div className="mt-1 text-[11px]">Descuento: {c.descuentoMotivo}</div>}
      </div>
      <div className="mt-2 border-t border-dashed border-black pt-1">
        {c.pagos.map((p, i) => <div key={i} className="flex justify-between"><span>{p.metodo}{p.referencia ? ` (${p.referencia})` : ''}</span><span>{Number(p.monto).toFixed(2)}</span></div>)}
        {vuelto && Number(vuelto) > 0 && <div className="flex justify-between font-bold"><span>VUELTO</span><span>{Number(vuelto).toFixed(2)}</span></div>}
      </div>
      <div className="mt-2 text-center text-[11px]">
        <div>Atendido por: {c.cajero}</div>
        <div className="mt-1">{SUNAT[c.estadoSunat] ?? c.estadoSunat}</div>
        <div className="mt-1">¡Gracias por su visita!</div>
      </div>
    </div>
  );
}
