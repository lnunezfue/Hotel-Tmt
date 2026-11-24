import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CanalActivo, type Cliente, type Disponibles, type Estancia, type Liquidacion, type TurnoActivo } from '../../lib/api';
import { puede, useSesion } from '../../features/auth/sesion';
import { fechaHoraLima, MOTIVOS_VIAJE } from '../../features/hospedaje/reservas';
import { soles } from '../../features/hospedaje/formato';
import { Button } from '../ui/Button';
import { Aviso, Campo, Entrada, Selector } from '../ui/form';
import { BuscadorCliente } from './clientes';

export function useCanales() {
  return useQuery({ queryKey: ['canales-activos'], queryFn: () => api<CanalActivo[]>('/hospedaje/canales'), staleTime: 60_000 });
}
export function useTurnos() {
  return useQuery({ queryKey: ['turnos-activos'], queryFn: () => api<TurnoActivo[]>('/hospedaje/turnos'), staleTime: 60_000 });
}

/** Lo que cambia con un check-in, una extensión o un check-out. */
export function useRefrescarHospedaje() {
  const qc = useQueryClient();
  return () => {
    // La liquidación se pide al abrir el check-out; tras salir la estancia ya no la tiene (409), así que no se recarga.
    for (const k of ['tablero', 'calendario', 'reserva', 'estancia', 'libro']) {
      qc.invalidateQueries({ queryKey: [k], predicate: (q) => q.queryKey[2] !== 'liquidacion' });
    }
  };
}

export type OrigenCheckin =
  | { tipo: 'reserva'; reservaHabitacionId: number; codigo: string; titularId: number; habitacion: { numero: string; tipo: string; capacidad: number }; detalle: string }
  | { tipo: 'walkin'; habitacion: { id: number; numero: string; tipo: string; capacidad: number } };

function Persona({ c, onQuitar, titular }: { c: Pick<Cliente, 'id' | 'nombreCompleto' | 'tipoDocumentoAbrev' | 'numeroDocumento'>; onQuitar: () => void; titular?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-borde px-3 py-2 text-sm">
      <div className="flex flex-col">
        <span className="font-medium">{c.nombreCompleto}{titular && <span className="ml-2 text-xs font-normal text-tinta-suave">titular</span>}</span>
        <span className="text-xs text-tinta-suave">{c.tipoDocumentoAbrev} {c.numeroDocumento}</span>
      </div>
      <button type="button" className="text-xs text-tinta-suave hover:text-tinta" onClick={onQuitar}>Quitar</button>
    </div>
  );
}

/** Check-in desde una reserva o sin ella (RF-RES-10) con los datos del libro de huéspedes (RF-RES-11). */
export function PanelCheckin({ origen, onListo }: { origen: OrigenCheckin; onListo: (e: Estancia) => void }) {
  const refrescar = useRefrescarHospedaje();
  const canales = useCanales();
  const turnos = useTurnos();
  const [titular, setTitular] = useState<Cliente | null>(null);
  const [acompanantes, setAcompanantes] = useState<Cliente[]>([]);
  const [procedencia, setProcedencia] = useState('');
  const [destino, setDestino] = useState('');
  const [motivo, setMotivo] = useState<string>('Turismo');
  const [placa, setPlaca] = useState('');
  const [canalId, setCanalId] = useState<number | null>(null);
  const [turnoId, setTurnoId] = useState<number | null>(null);
  const [cantidad, setCantidad] = useState('1');
  const walkin = origen.tipo === 'walkin';

  // El titular de la reserva entra como huésped si es una persona (una empresa reserva, pero no se aloja).
  const titularReserva = useQuery({
    queryKey: ['clientes', 'uno', origen.tipo === 'reserva' ? origen.titularId : 0],
    queryFn: () => api<Cliente>(`/hospedaje/clientes/${origen.tipo === 'reserva' ? origen.titularId : 0}`),
    enabled: origen.tipo === 'reserva',
  });
  useEffect(() => {
    if (titularReserva.data?.esPersona) setTitular((t) => t ?? titularReserva.data);
  }, [titularReserva.data]);
  useEffect(() => {
    if (canalId === null && canales.data?.length) setCanalId(canales.data[0].id);
    if (turnoId === null && turnos.data?.length) setTurnoId(turnos.data[0].id);
  }, [canales.data, turnos.data, canalId, turnoId]);

  const n = Number(cantidad);
  const cantidadValida = Number.isInteger(n) && n >= 1 && n <= 60;
  // Precio y disponibilidad del walk-in: la misma consulta que usa la reserva, con entrada ahora.
  const [ahora] = useState(() => new Date().toISOString());
  const disp = useQuery({
    queryKey: ['disponibles', 'walkin', canalId, turnoId, n, ahora],
    queryFn: () => api<Disponibles>(`/hospedaje/reservas/disponibles?${new URLSearchParams({ entrada: ahora, turnoId: String(turnoId), cantidad: String(n), canalId: String(canalId) })}`),
    enabled: walkin && canalId !== null && turnoId !== null && cantidadValida,
  });
  const libre = walkin ? disp.data?.habitaciones.find((h) => h.id === origen.habitacion.id) : undefined;

  const registrar = useMutation({
    mutationFn: () => {
      const comun = { titularId: titular!.id, acompanantes: acompanantes.map((a) => a.id), procedencia, destino: destino || null, motivoViaje: motivo, placaVehiculo: placa || null };
      const cuerpo = origen.tipo === 'reserva'
        ? { reservaHabitacionId: origen.reservaHabitacionId, ...comun }
        : { habitacionId: origen.habitacion.id, canalId, turnoId, cantidadTurnos: n, ...comun };
      return api<Estancia>('/hospedaje/estancias', { method: 'POST', body: JSON.stringify(cuerpo) });
    },
    onSuccess: (e) => { refrescar(); onListo(e); },
  });

  const capacidad = origen.habitacion.capacidad;
  const huespedes = (titular ? 1 : 0) + acompanantes.length;
  const elegidos = [titular?.id, ...acompanantes.map((a) => a.id)].filter((x): x is number => x !== undefined);
  const listo = titular && procedencia.trim().length >= 2 && huespedes <= capacidad && (!walkin || (cantidadValida && libre?.precio));

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg bg-fondo p-3 text-sm">
        <div className="font-semibold">Habitación {origen.habitacion.numero} · {origen.habitacion.tipo} · hasta {capacidad} personas</div>
        <div className="text-tinta-suave">{origen.tipo === 'reserva' ? `Reserva ${origen.codigo} · ${origen.detalle}` : 'Sin reserva (walk-in)'}</div>
      </div>

      {walkin && (
        <div className="grid grid-cols-3 gap-3">
          <Campo etiqueta="Canal">
            <Selector value={canalId ?? ''} onChange={(e) => setCanalId(Number(e.target.value))}>
              {canales.data?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Turno">
            <Selector value={turnoId ?? ''} onChange={(e) => setTurnoId(Number(e.target.value))}>
              {turnos.data?.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Turnos"><Entrada type="number" min={1} max={60} value={cantidad} onChange={(e) => setCantidad(e.target.value)} /></Campo>
        </div>
      )}
      {walkin && disp.data && (
        libre?.precio ? (
          <div className="flex justify-between rounded-lg border border-borde px-3 py-2 text-sm">
            <span>{soles(libre.precio)} × {n} · sale {fechaHoraLima(disp.data.salida)}</span>
            <b className="tabular-nums">{soles(Number(libre.precio) * n)}</b>
          </div>
        ) : (
          <Aviso>{libre ? 'No hay tarifa vigente para esa combinación.' : 'La habitación tiene una reserva en ese horario: reduce los turnos o elige otra.'}</Aviso>
        )
      )}

      <div className="flex flex-col gap-2">
        <span className="text-xs tracking-widest text-tinta-suave uppercase">Huéspedes · {huespedes} de {capacidad}</span>
        {titularReserva.data && !titularReserva.data.esPersona && !titular && (
          <p className="text-xs text-tinta-suave">El titular de la reserva es {titularReserva.data.nombreCompleto}; registra a la persona que se aloja.</p>
        )}
        {titular ? (
          <Persona c={titular} titular onQuitar={() => setTitular(null)} />
        ) : (
          <BuscadorCliente etiqueta="Huésped titular" soloPersonas excluir={elegidos} onElegir={setTitular} />
        )}
        {acompanantes.map((a) => <Persona key={a.id} c={a} onQuitar={() => setAcompanantes((l) => l.filter((x) => x.id !== a.id))} />)}
        {titular && huespedes < capacidad && (
          <BuscadorCliente etiqueta="Agregar acompañante" soloPersonas excluir={elegidos} onElegir={(c) => setAcompanantes((l) => [...l, c])} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Procedencia"><Entrada value={procedencia} maxLength={100} onChange={(e) => setProcedencia(e.target.value)} placeholder="Ciudad, país" /></Campo>
        <Campo etiqueta="Destino (opcional)"><Entrada value={destino} maxLength={100} onChange={(e) => setDestino(e.target.value)} /></Campo>
        <Campo etiqueta="Motivo del viaje">
          <Selector value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            {MOTIVOS_VIAJE.map((m) => <option key={m}>{m}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Placa (opcional)"><Entrada value={placa} maxLength={10} onChange={(e) => setPlaca(e.target.value)} /></Campo>
      </div>

      {registrar.error && <Aviso>{registrar.error.message}</Aviso>}
      <Button variante="primario" disabled={!listo || registrar.isPending} onClick={() => registrar.mutate()}>Registrar check-in</Button>
    </div>
  );
}

/** Estancia en curso: huéspedes, extensión (RF-RES-13) y check-out con su liquidación (RF-RES-12). */
export function PanelEstancia({ estanciaId, onSalida }: { estanciaId: number; onSalida?: (l: Liquidacion) => void }) {
  const { data: sesion } = useSesion();
  const refrescar = useRefrescarHospedaje();
  const estancia = useQuery({ queryKey: ['estancia', estanciaId], queryFn: () => api<Estancia>(`/hospedaje/estancias/${estanciaId}`) });
  const [turnos, setTurnos] = useState('1');
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<Liquidacion | null>(null);
  const extender = useMutation({
    mutationFn: () => api<Estancia>(`/hospedaje/estancias/${estanciaId}/extension`, { method: 'POST', body: JSON.stringify({ turnos: Number(turnos) }) }),
    onSuccess: () => { setTurnos('1'); refrescar(); },
  });
  const liquidacion = useQuery({
    queryKey: ['estancia', estanciaId, 'liquidacion'],
    queryFn: () => api<Liquidacion>(`/hospedaje/estancias/${estanciaId}/liquidacion`),
    enabled: confirmando,
  });
  const salir = useMutation({
    mutationFn: () => api<{ liquidacion: Liquidacion }>(`/hospedaje/estancias/${estanciaId}/checkout`, { method: 'POST' }),
    onSuccess: (r) => { setResultado(r.liquidacion); setConfirmando(false); onSalida?.(r.liquidacion); refrescar(); },
  });

  if (resultado) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-desocupada/40 bg-desocupada/8 p-3 text-sm">
        <span className="font-semibold text-desocupada">Check-out registrado</span>
        <span>{resultado.consumidos} turno(s) × {soles(resultado.precioUnitario)} = <b>{soles(resultado.importe)}</b></span>
        <span className="text-xs text-tinta-suave">La habitación pasó a limpieza. El cobro y el comprobante se harán desde Ventas (fase F3).</span>
      </div>
    );
  }
  const e = estancia.data;
  if (estancia.error) return <Aviso>{estancia.error.message}</Aviso>;
  if (!e) return <p className="text-sm text-tinta-suave">Cargando estancia…</p>;
  const n = Number(turnos);
  const l = liquidacion.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-lg border border-borde p-3 text-sm">
        {e.huespedes.map((h) => (
          <span key={h.id} className={h.titular ? 'font-semibold' : ''}>{h.nombre} <span className="text-xs font-normal text-tinta-suave">· {h.documento}</span></span>
        ))}
        <span className="mt-1 text-tinta-suave">Ingreso: {fechaHoraLima(e.checkin)} · por {e.ingresoPor}</span>
        <span className="text-tinta-suave">Salida prevista: {fechaHoraLima(e.salidaPrevista)}</span>
        <span className="text-tinta-suave">{e.cantidadTurnos} × {e.turno.nombre} · {soles(e.precioUnitario)} · {e.canal.nombre}{e.reserva ? ` · ${e.reserva.codigo}` : ''}</span>
        {e.salida && <span className="text-tinta-suave">Salió: {fechaHoraLima(e.salida)} · por {e.salidaPor} · {soles(e.montoHospedaje)}</span>}
      </div>

      {e.estado === 'ACTIVA' && puede(sesion, 'estancia.checkin') && (
        <div className="flex flex-col gap-2">
          <span className="text-xs tracking-widest text-tinta-suave uppercase">Extender estancia</span>
          <div className="flex items-end gap-2">
            <Campo etiqueta={`Turnos de ${e.turno.horas} h`} className="w-28"><Entrada type="number" min={1} max={30} value={turnos} onChange={(ev) => setTurnos(ev.target.value)} /></Campo>
            <Button disabled={!(Number.isInteger(n) && n >= 1 && n <= 30) || extender.isPending} onClick={() => extender.mutate()}>Extender {soles(Number(e.precioUnitario) * (n || 0))}</Button>
          </div>
          {extender.error && <Aviso>{extender.error.message}</Aviso>}
          {extender.isSuccess && <Aviso tipo="ok">Estancia extendida hasta el {fechaHoraLima(extender.data.salidaPrevista)}</Aviso>}
        </div>
      )}

      {e.estado === 'ACTIVA' && puede(sesion, 'estancia.checkout') && (
        <div className="flex flex-col gap-2">
          <span className="text-xs tracking-widest text-tinta-suave uppercase">Check-out</span>
          {!confirmando ? (
            <Button variante="primario" onClick={() => setConfirmando(true)}>Hacer check-out</Button>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-borde p-3 text-sm">
              {l ? (
                <>
                  <div className="flex justify-between"><span>Turnos contratados</span><b className="tabular-nums">{l.contratados}</b></div>
                  {l.adicionales > 0 && <div className="flex justify-between text-ocupada"><span>Por salida tardía</span><b className="tabular-nums">+{l.adicionales}</b></div>}
                  <div className="flex justify-between"><span>{l.consumidos} × {soles(l.precioUnitario)}</span><b className="tabular-nums">{soles(l.importe)}</b></div>
                  {l.adicionales > 0 && <p className="text-xs text-tinta-suave">Pasaron más de 30 minutos de la salida prevista: se cobra otro turno.</p>}
                  <div className="flex gap-2">
                    <Button variante="primario" disabled={salir.isPending} onClick={() => salir.mutate()}>Confirmar check-out</Button>
                    <Button variante="fantasma" onClick={() => setConfirmando(false)}>Cancelar</Button>
                  </div>
                </>
              ) : (
                <span className="text-tinta-suave">{liquidacion.error ? liquidacion.error.message : 'Calculando…'}</span>
              )}
              {salir.error && <Aviso>{salir.error.message}</Aviso>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
