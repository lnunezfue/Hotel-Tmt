import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, type Cliente, type Estancia, type ResultadoCheckout } from '../../lib/api';
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
export function ComprobanteEmitido({ r, onListo }: { r: ResultadoCheckout; onListo: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Aviso tipo="ok">Check-out hecho. {r.comprobante} por {soles(r.total)}{Number(r.vuelto) > 0 ? ` · vuelto ${soles(r.vuelto)}` : ''}. Las habitaciones quedan en limpieza.</Aviso>
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
  const canales = useQuery({ queryKey: ['reservas', 'canales'], queryFn: () => api<Canal[]>('/hospedaje/canales') });
  const [titular, setTitular] = useState<Cliente | null>(null);
  const [acomp, setAcomp] = useState<Cliente[]>([]);
  const [otro, setOtro] = useState<Cliente | null>(null);
  const [turnoId, setTurnoId] = useState<number | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [procedencia, setProcedencia] = useState('');
  const [destino, setDestino] = useState('');
  const [motivoViaje, setMotivoViaje] = useState<string>('Turismo');
  const turno = turnos.data?.find((t) => t.id === turnoId) ?? turnos.data?.find((t) => t.duracion_horas === 24);
  const canal = canales.data?.find((c) => c.nombre === 'Recepción' && c.activo !== false) ?? canales.data?.find((c) => c.activo !== false);
  const precio = useQuery({
    queryKey: ['reservas', 'precio', habitacion?.tipoId, canal?.id, turno?.id, hoyLima()],
    queryFn: () => api<{ precio: string }>(`/hospedaje/tarifas/vigente?${new URLSearchParams({ tipoId: String(habitacion!.tipoId), canalId: String(canal!.id), turnoId: String(turno!.id), fecha: hoyLima() })}`),
    enabled: !!habitacion && !!canal && !!turno,
    retry: false,
  });
  const crear = useMutation({
    mutationFn: () => api<Estancia>('/estancias', { method: 'POST', body: JSON.stringify({ habitacionId: habitacion!.id, clienteId: titular!.id, acompanantes: acomp.map((a) => a.id), canalId: canal!.id, turnoId: turno!.id, cantidad, procedencia, destino: destino || null, motivoViaje }) }),
    onSuccess: () => { refrescar(); setTitular(null); setAcomp([]); onCerrar(); },
  });
  const lleno = 1 + acomp.length >= (habitacion?.capacidad ?? 1);

  return (
    <PanelLateral titulo={`Check-in directo · habitación ${habitacion?.numero ?? ''}`} abierto={!!habitacion} onCerrar={onCerrar}>
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
              {turnos.data?.map((t) => <option key={t.id} value={t.id}>{t.duracion_horas === 24 ? 'Por noche (24 h)' : `${t.duracion_horas} horas`}</option>)}
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
          <div className="text-xs text-tinta-suave">Se cobra al salir, junto con los consumos.</div>
        </div>
        {crear.error && <Aviso>{crear.error.message}</Aviso>}
        <Button variante="primario" className="h-10" disabled={!titular || !precio.data || procedencia.trim().length < 2 || crear.isPending} onClick={() => crear.mutate()}>Hacer check-in</Button>
      </div>
    </PanelLateral>
  );
}
