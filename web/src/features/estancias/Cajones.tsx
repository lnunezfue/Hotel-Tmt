import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type Cliente, type Estancia, type MetodoPago, type ResultadoCheckout } from '../../lib/api';
import { horaConDia, salidaPrevista, useOperacion } from '../hospedaje/operacion';
import { soles } from '../hospedaje/formato';
import { hoyLima } from '../reservas/fechas';
import { ElegirHuesped } from '../reservas/PanelNuevaReserva';
import { Button } from '../../components/ui/Button';
import { Aviso, Campo, Entrada, PanelLateral, Selector } from '../../components/ui/form';
import { PanelEstancia, useRefrescarHotel } from './PanelEstancia';
import { MOTIVOS_VIAJE } from './libro';
import { VistaComprobante } from './VistaComprobante';

interface Turno { id: number; nombre: string; duracion_horas: number }
interface Canal { id: number; nombre: string; activo?: boolean }

/** Comprobante recién emitido, con imprimir. */
export function ComprobanteEmitido({ r, onListo, titulo }: { r: ResultadoCheckout; onListo: () => void; titulo?: string }) {
  if (r.comprobanteId === null) {
    return (
      <div className="flex flex-col gap-4">
        <Aviso tipo="ok">Check-out hecho. La cuenta ya estaba pagada; la habitación queda en limpieza.</Aviso>
        <Button variante="primario" onClick={onListo}>Listo</Button>
      </div>
    );
  }
  const vuelto = Number(r.vuelto) > 0 ? ` · vuelto ${soles(r.vuelto)}` : '';
  return (
    <div className="flex flex-col gap-4">
      <Aviso tipo="ok">
        {titulo ?? (r.cerrada ? 'Check-out hecho.' : 'Cobrado.')} {r.comprobante} por {soles(r.total)}{vuelto}.{' '}
        {r.cerrada ? 'Las habitaciones quedan en limpieza.' : 'La estadía sigue en curso; al salir, el check-out ya no cobra.'}
      </Aviso>
      <VistaComprobante id={r.comprobanteId} vuelto={r.vuelto} />
      <div className="flex gap-2">
        <Button onClick={() => window.print()}>Imprimir</Button>
        <Button variante="primario" onClick={onListo}>Listo</Button>
      </div>
    </div>
  );
}

/** Cajón lateral de una habitación ocupada: estadía, consumos, check-out y comprobante. */
export function CajonEstancia({ habitacionId, onCerrar }: { habitacionId: number | null; numero?: string; onCerrar: () => void }) {
  const [hecho, setHecho] = useState<ResultadoCheckout | null>(null);
  const cerrar = () => { setHecho(null); onCerrar(); };
  return (
    <PanelLateral titulo={hecho ? 'Comprobante' : 'Estadía en curso'} abierto={habitacionId !== null} onCerrar={cerrar}>
      {habitacionId !== null && (hecho ? <ComprobanteEmitido r={hecho} onListo={cerrar} /> : <PanelEstancia key={habitacionId} habitacionId={habitacionId} onComprobante={setHecho} />)}
    </PanelLateral>
  );
}

/** Huésped que llega sin reserva (walk-in): turno por horas o por noche, con acompañantes. */
export function CajonCheckinDirecto({ habitacion, onCerrar }: { habitacion: { id: number; numero: string; tipoId: number; capacidad: number } | null; onCerrar: () => void }) {
  const refrescar = useRefrescarHotel();
  const turnos = useQuery({ queryKey: ['reservas', 'turnos'], queryFn: () => api<Turno[]>('/hospedaje/turnos') });
  const op = useOperacion().data;
  const metodos = useQuery({ queryKey: ['caja', 'metodos'], queryFn: () => api<MetodoPago[]>('/caja/metodos-pago') });
  // Pago adelantado (operación real): comprobante, cómo paga y cuánto entrega
  const [comprobante, setComprobante] = useState<'BOLETA' | 'INTERNO'>('BOLETA');
  const [metodoId, setMetodoId] = useState<number | null>(null);
  const [recibido, setRecibido] = useState('');
  const [referencia, setReferencia] = useState('');
  const [hecho, setHecho] = useState<ResultadoCheckout | null>(null);
  const [sinCobro, setSinCobro] = useState<string | null>(null);
  const canales = useQuery({ queryKey: ['reservas', 'canales'], queryFn: () => api<Canal[]>('/hospedaje/canales') });
  const [titular, setTitular] = useState<Cliente | null>(null);
  const [acomp, setAcomp] = useState<Cliente[]>([]);
  const [otro, setOtro] = useState<Cliente | null>(null);
  const [turnoId, setTurnoId] = useState<number | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [procedencia, setProcedencia] = useState('');
  const [destino, setDestino] = useState('');
  const [motivoViaje, setMotivoViaje] = useState<string>('Turismo');
  const turno = turnos.data?.find((t) => t.id === turnoId) ?? turnos.data?.find((t) => t.id === op?.turnoSugeridoId) ?? turnos.data?.find((t) => t.duracion_horas === 24);
  const prevista = turno ? salidaPrevista(new Date(), turno.duracion_horas, cantidad, op) : null;
  const cobraAhora = !!op?.cobroAlIngreso;
  const metodo = metodos.data?.find((m) => m.id === metodoId) ?? metodos.data?.find((m) => m.es_efectivo);
  const canal = canales.data?.find((c) => c.nombre === 'Recepción' && c.activo !== false) ?? canales.data?.find((c) => c.activo !== false);
  const precio = useQuery({
    queryKey: ['reservas', 'precio', habitacion?.tipoId, canal?.id, turno?.id, hoyLima()],
    queryFn: () => api<{ precio: string }>(`/hospedaje/tarifas/vigente?${new URLSearchParams({ tipoId: String(habitacion!.tipoId), canalId: String(canal!.id), turnoId: String(turno!.id), fecha: hoyLima() })}`),
    enabled: !!habitacion && !!canal && !!turno,
    retry: false,
  });
  const total = precio.data ? Number(precio.data.precio) * cantidad : 0;
  const entregado = metodo?.es_efectivo && recibido !== '' ? Number(recibido) : total;
  const vuelto = Math.max(0, entregado - total);
  const limpiar = () => { setTitular(null); setAcomp([]); setHecho(null); setSinCobro(null); setRecibido(''); setReferencia(''); setMetodoId(null); setTurnoId(null); setCantidad(1); };
  const cerrar = () => { limpiar(); onCerrar(); };
  const crear = useMutation({
    mutationFn: async () => {
      const e = await api<Estancia>('/estancias', { method: 'POST', body: JSON.stringify({ habitacionId: habitacion!.id, clienteId: titular!.id, acompanantes: acomp.map((a) => a.id), canalId: canal!.id, turnoId: turno!.id, cantidad, procedencia, destino: destino || null, motivoViaje }) });
      if (!cobraAhora) return null;
      // El check-in ya quedó hecho: si el cobro falla (p. ej. caja cerrada) se avisa y se cobra desde la habitación
      try {
        return await api<ResultadoCheckout>(`/estancias/${e.id}/cobro`, {
          method: 'POST',
          body: JSON.stringify({ tipoComprobante: comprobante, pagos: [{ metodoPagoId: metodo!.id, monto: entregado, referencia: referencia.trim() || null }] }),
        });
      } catch (err) {
        setSinCobro((err as Error).message);
        return null;
      }
    },
    onSuccess: (r) => {
      refrescar();
      if (r) setHecho(r);
      else if (!cobraAhora) cerrar();
    },
  });
  const lleno = 1 + acomp.length >= (habitacion?.capacidad ?? 1);

  return (
    <PanelLateral titulo={`Check-in directo · habitación ${habitacion?.numero ?? ''}`} abierto={!!habitacion} onCerrar={cerrar}>
      {hecho ? (
        <ComprobanteEmitido r={hecho} onListo={cerrar} titulo={`Check-in hecho y cobrado. Sale a las ${prevista ? horaConDia(prevista.salida) : ''}.`} />
      ) : sinCobro ? (
        <div className="flex flex-col gap-4">
          <Aviso tipo="info">El check-in quedó hecho, pero no se pudo cobrar: {sinCobro}</Aviso>
          <p className="text-sm text-tinta-suave">Abre la habitación en el tablero y usa «Cobrar» cuando se resuelva.</p>
          <Button variante="primario" onClick={cerrar}>Entendido</Button>
        </div>
      ) : (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-tinta-suave">Para el huésped que llega sin reserva. El precio sale de la tarifa de hoy.</p>
        <div className="flex flex-col gap-1 text-sm"><span className="font-medium">Huésped titular</span><ElegirHuesped valor={titular} onCambio={setTitular} /></div>
        {titular && (
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Acompañantes ({acomp.length})</span>
            {acomp.map((a) => <div key={a.id} className="flex justify-between"><span>{a.nombre}</span><button className="text-xs text-tinta-suave" onClick={() => setAcomp(acomp.filter((x) => x.id !== a.id))}>Quitar</button></div>)}
            {!lleno && (otro ? <Button onClick={() => { setAcomp([...acomp, otro]); setOtro(null); }}>Agregar a {otro.nombre}</Button> : <ElegirHuesped valor={null} onCambio={setOtro} />)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Turno">
            <Selector value={turno?.id ?? ''} onChange={(e) => setTurnoId(Number(e.target.value))}>
              {turnos.data?.map((t) => <option key={t.id} value={t.id}>{t.duracion_horas === 24 ? (op?.horaSalidaNoche ? `Noche completa (sale ${op.horaSalidaNoche})` : 'Por noche (24 h)') : `${t.duracion_horas} horas`}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta={turno?.duracion_horas === 24 ? 'Noches' : 'Turnos'}><Entrada type="number" min={1} max={30} value={cantidad} onChange={(e) => setCantidad(Math.max(1, Number(e.target.value)))} /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Procedencia"><Entrada value={procedencia} onChange={(e) => setProcedencia(e.target.value)} placeholder="Arequipa, Lima, Chile…" /></Campo>
          <Campo etiqueta="Destino (opcional)"><Entrada value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="A dónde sigue" /></Campo>
          <Campo etiqueta="Motivo del viaje" className="col-span-2">
            <Selector value={motivoViaje} onChange={(e) => setMotivoViaje(e.target.value)}>
              {MOTIVOS_VIAJE.map((m) => <option key={m}>{m}</option>)}
            </Selector>
          </Campo>
        </div>
        <div className="rounded-lg bg-fondo p-3 text-sm">
          {precio.data ? <div className="flex justify-between"><span>{soles(precio.data.precio)} × {cantidad}</span><b className="tabular-nums">{soles(Number(precio.data.precio) * cantidad)}</b></div> : <span className="text-tinta-suave">{precio.isError ? 'No hay tarifa para este turno.' : 'Calculando precio…'}</span>}
          {prevista && (
            <div className={clsx('flex justify-between', prevista.excede && 'text-ocupada')}>
              <span>Sale a las</span>
              <b>{horaConDia(prevista.salida)}</b>
            </div>
          )}
          {prevista?.maxima && <div className="text-xs text-tinta-suave">Ingreso en la franja «{prevista.franja}»: salida máxima {horaConDia(prevista.maxima)}.</div>}
          {!cobraAhora && <div className="text-xs text-tinta-suave">Se cobra al salir, junto con los consumos.</div>}
        </div>
        {prevista?.excede && (
          <Aviso>
            Pasa la hora máxima de salida. {prevista.caben && prevista.caben > 0 ? `Caben ${prevista.caben} ${prevista.caben === 1 ? 'turno' : 'turnos'} de ${turno?.duracion_horas} h` : `No cabe un turno de ${turno?.duracion_horas} h`}, o vende la noche completa.
          </Aviso>
        )}
        {cobraAhora && precio.data && (
          <div className="flex flex-col gap-2 rounded-lg border border-borde p-3 text-sm">
            <span className="font-medium">Pago adelantado</span>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-fondo p-1" role="radiogroup" aria-label="Comprobante">
              {([['BOLETA', 'Boleta'], ['INTERNO', 'Nota interna']] as const).map(([t, texto]) => (
                <button key={t} role="radio" aria-checked={comprobante === t} onClick={() => setComprobante(t)} className={clsx('rounded-md py-1 text-sm font-medium', comprobante === t ? 'bg-white shadow-sm' : 'text-tinta-suave')}>{texto}</button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Cómo paga">
              {metodos.data?.filter((m) => m.codigo !== 'OTA').map((m) => (
                <button key={m.id} role="radio" aria-checked={metodo?.id === m.id} onClick={() => { setMetodoId(m.id); setRecibido(''); }} className={clsx('rounded-md border px-2 py-1 text-xs', metodo?.id === m.id ? 'border-acento bg-acento-suave font-semibold text-acento' : 'border-borde')}>
                  {m.descripcion}
                </button>
              ))}
            </div>
            {metodo?.es_efectivo ? (
              <div className="grid grid-cols-2 items-end gap-2">
                <Campo etiqueta="Recibe"><Entrada type="number" min={0} step="0.10" value={recibido} placeholder={total.toFixed(2)} onChange={(e) => setRecibido(e.target.value)} /></Campo>
                <div className={clsx('rounded-lg p-2', vuelto > 0 ? 'bg-desocupada/10' : 'bg-fondo')}><div className="text-xs text-tinta-suave">Vuelto</div><b className="tabular-nums">{soles(vuelto)}</b></div>
              </div>
            ) : (
              <Entrada className="h-8 text-xs" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="N.º de operación (opcional)" />
            )}
            {entregado < total && <span className="text-xs text-ocupada">Falta {soles(total - entregado)}</span>}
          </div>
        )}
        {crear.error && <Aviso>{crear.error.message}</Aviso>}
        <Button
          variante="primario"
          className="h-10"
          disabled={!titular || !precio.data || procedencia.trim().length < 2 || crear.isPending || !!prevista?.excede || (cobraAhora && (!metodo || entregado < total))}
          onClick={() => crear.mutate()}
        >
          {crear.isPending ? 'Guardando…' : cobraAhora && precio.data ? `Cobrar ${soles(total)} y hacer check-in` : 'Hacer check-in'}
        </Button>
      </div>
      )}
    </PanelLateral>
  );
}
