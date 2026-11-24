import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type BloqueCalendario, type Calendario, type Cliente, type Disponibles, type EstadoReserva, type Reserva } from '../lib/api';
import { puede, useSesion } from '../features/auth/sesion';
import { diaLima, ESTILO_RESERVA, fechaHoraLima, instanteLima, sumarDias, totalReserva, ubicarBloque } from '../features/hospedaje/reservas';
import { fechaCorta, soles } from '../features/hospedaje/formato';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Aviso, Campo, Entrada, PanelLateral, Pestanas, Pildora, Selector } from '../components/ui/form';
import { BuscadorCliente } from '../components/hospedaje/clientes';
import { PanelCheckin, PanelEstancia, useCanales, useRefrescarHospedaje, useTurnos, type OrigenCheckin } from '../components/hospedaje/estancias';

const DIAS = 14;
const COLUMNA = 112; // ancho de la columna de habitaciones, en px

type Panel = { tipo: 'nueva'; habitacionId?: number; dia?: string } | { tipo: 'reserva'; id: number } | { tipo: 'estancia'; id: number };

const claseBloque = (b: BloqueCalendario) =>
  b.tipo === 'estancia'
    ? b.estado === 'ACTIVA' ? 'bg-ocupada/12 border-ocupada/50 text-ocupada' : 'bg-fondo border-borde text-tinta-suave'
    : ESTILO_RESERVA[b.estado as EstadoReserva]?.clase ?? 'bg-fondo border-borde';

// ── Calendario ──────────────────────────────────────────────────

function VistaCalendario({ onPanel }: { onPanel: (p: Panel) => void }) {
  const { data: sesion } = useSesion();
  const hoy = diaLima(new Date());
  const [desde, setDesde] = useState(hoy);
  const cal = useQuery({
    queryKey: ['calendario', desde],
    queryFn: () => api<Calendario>(`/hospedaje/reservas/calendario?desde=${desde}&dias=${DIAS}`),
    refetchInterval: 60_000,
  });
  const dias = useMemo(() => Array.from({ length: DIAS }, (_, i) => sumarDias(desde, i)), [desde]);
  const puedeReservar = puede(sesion, 'reserva.crear');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDesde(sumarDias(desde, -7))} aria-label="Semana anterior">←</Button>
        <Button onClick={() => setDesde(hoy)} disabled={desde === hoy}>Hoy</Button>
        <Button onClick={() => setDesde(sumarDias(desde, 7))} aria-label="Semana siguiente">→</Button>
        <span className="text-sm text-tinta-suave">{fechaCorta(desde)} – {fechaCorta(dias[DIAS - 1])}</span>
        {puedeReservar && <Button variante="primario" className="ml-auto" onClick={() => onPanel({ tipo: 'nueva' })}>+ Nueva reserva</Button>}
      </div>
      {cal.error && <Aviso>{cal.error.message}</Aviso>}
      <Card className="min-w-0 overflow-x-auto">
        <div className="min-w-[980px]">
          <div className="grid border-b border-borde bg-fondo text-xs font-semibold tracking-wide text-tinta-suave uppercase" style={{ gridTemplateColumns: `${COLUMNA}px repeat(${DIAS}, 1fr)` }}>
            <div className="px-3 py-2">Habitación</div>
            {dias.map((d) => {
              const fecha = new Date(`${d}T12:00:00-05:00`);
              return (
                <div key={d} className={clsx('px-1 py-2 text-center', d === hoy && 'text-acento')}>
                  {fecha.toLocaleDateString('es-PE', { timeZone: 'America/Lima', weekday: 'short' })} {d.slice(8)}
                </div>
              );
            })}
          </div>
          {cal.isLoading && <p className="px-3 py-6 text-sm text-tinta-suave">Cargando calendario…</p>}
          {cal.data?.habitaciones.map((h) => (
            <div key={h.id} className="relative grid h-12 border-b border-borde last:border-0" style={{ gridTemplateColumns: `${COLUMNA}px repeat(${DIAS}, 1fr)` }}>
              <div className="flex flex-col justify-center px-3 leading-tight">
                <span className="font-semibold tabular-nums">{h.numero}</span>
                <span className="text-[11px] text-tinta-suave">{h.tipo}</span>
              </div>
              {dias.map((d) => (
                <button
                  key={d}
                  className={clsx('border-l border-borde', d === hoy && 'bg-acento/5', puedeReservar && d >= hoy ? 'hover:bg-acento/10' : 'cursor-default')}
                  aria-label={`Reservar ${h.numero} el ${fechaCorta(d)}`}
                  disabled={!puedeReservar || d < hoy}
                  onClick={() => onPanel({ tipo: 'nueva', habitacionId: h.id, dia: d })}
                />
              ))}
              {cal.data.bloques.filter((b) => b.habitacionId === h.id).map((b) => {
                const pos = ubicarBloque(new Date(b.inicio), new Date(b.fin), desde, DIAS);
                if (!pos) return null;
                return (
                  <button
                    key={`${b.tipo}-${b.estanciaId ?? b.reservaId}-${b.inicio}`}
                    onClick={() => onPanel(b.tipo === 'estancia' && b.estanciaId ? { tipo: 'estancia', id: b.estanciaId } : { tipo: 'reserva', id: b.reservaId! })}
                    className={clsx('absolute top-1.5 bottom-1.5 flex flex-col justify-center overflow-hidden rounded-md border px-2 text-left text-[11px] leading-tight hover:shadow', claseBloque(b))}
                    style={{ left: `calc(${COLUMNA}px + (100% - ${COLUMNA}px) * ${pos.desde / DIAS} + 1px)`, width: `calc((100% - ${COLUMNA}px) * ${(pos.hasta - pos.desde) / DIAS} - 2px)` }}
                    title={`${b.titular} · ${b.canal}${b.codigo ? ` · ${b.codigo}` : ''}`}
                  >
                    <span className="truncate font-semibold">{b.titular}</span>
                    <span className="truncate opacity-80">{b.tipo === 'estancia' ? (b.estado === 'ACTIVA' ? 'alojado' : 'salió') : ESTILO_RESERVA[b.estado as EstadoReserva]?.etiqueta.toLowerCase()} · {b.canal}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 border-t border-borde px-3 py-2 text-xs text-tinta-suave">
          {(['PENDIENTE', 'CONFIRMADA'] as const).map((e) => (
            <span key={e} className="flex items-center gap-1.5"><span className={clsx('h-3 w-5 rounded border', ESTILO_RESERVA[e].clase)} /> {ESTILO_RESERVA[e].etiqueta}</span>
          ))}
          <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded border border-ocupada/50 bg-ocupada/12" /> Alojado</span>
          <span className="ml-auto">Clic en un día libre para reservar · el sistema impide cruces de horario (RF-RES-18)</span>
        </div>
      </Card>
    </div>
  );
}

// ── Nueva reserva ───────────────────────────────────────────────

function NuevaReserva({ habitacionId, dia, onCreada }: { habitacionId?: number; dia?: string; onCreada: (r: Reserva) => void }) {
  const refrescar = useRefrescarHospedaje();
  const canales = useCanales();
  const turnos = useTurnos();
  const [titular, setTitular] = useState<Cliente | null>(null);
  const [canalId, setCanalId] = useState<number | null>(null);
  const [fecha, setFecha] = useState(dia ?? diaLima(new Date()));
  const [hora, setHora] = useState('14:00');
  const [turnoId, setTurnoId] = useState<number | null>(null);
  const [cantidad, setCantidad] = useState('1');
  const [adultos, setAdultos] = useState('1');
  const [ninos, setNinos] = useState('0');
  const [externo, setExterno] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [elegidas, setElegidas] = useState<number[]>(habitacionId ? [habitacionId] : []);
  const canal = canales.data?.find((c) => c.id === (canalId ?? canales.data?.[0]?.id));
  const turno = turnos.data?.find((t) => t.id === (turnoId ?? turnos.data?.[0]?.id));
  const n = Number(cantidad);
  const cantidadValida = Number.isInteger(n) && n >= 1 && n <= 60;
  const entrada = instanteLima(fecha, hora);

  const disp = useQuery({
    queryKey: ['disponibles', entrada, turno?.id, n, canal?.id],
    queryFn: () => api<Disponibles>(`/hospedaje/reservas/disponibles?${new URLSearchParams({ entrada, turnoId: String(turno!.id), cantidad: String(n), canalId: String(canal!.id) })}`),
    enabled: Boolean(canal && turno && cantidadValida && /^\d{2}:\d{2}$/.test(hora) && fecha),
  });
  const libres = disp.data?.habitaciones ?? [];
  const seleccion = libres.filter((h) => elegidas.includes(h.id));
  const fuera = elegidas.filter((id) => !libres.some((h) => h.id === id));
  const total = totalReserva(seleccion.map((h) => h.precio), n);
  const capacidad = seleccion.reduce((s, h) => s + h.capacidad, 0);
  const personas = Number(adultos) + Number(ninos);

  const crear = useMutation({
    mutationFn: () =>
      api<Reserva>('/hospedaje/reservas', {
        method: 'POST',
        body: JSON.stringify({
          clienteId: titular!.id, canalId: canal!.id, entrada, turnoId: turno!.id, cantidadTurnos: n,
          adultos: Number(adultos), ninos: Number(ninos), habitacionIds: seleccion.map((h) => h.id),
          codigoExterno: canal?.es_ota && externo ? externo : null, observaciones: observaciones || null,
        }),
      }),
    onSuccess: (r) => { refrescar(); onCreada(r); },
  });
  const listo = titular && seleccion.length > 0 && total !== null && personas >= 1 && personas <= capacidad && fuera.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {titular ? (
        <div className="flex items-center justify-between rounded-lg border border-borde px-3 py-2 text-sm">
          <div className="flex flex-col"><span className="font-medium">{titular.nombreCompleto}</span><span className="text-xs text-tinta-suave">{titular.tipoDocumentoAbrev} {titular.numeroDocumento}</span></div>
          <button className="text-xs text-tinta-suave hover:text-tinta" onClick={() => setTitular(null)}>Cambiar</button>
        </div>
      ) : (
        <BuscadorCliente etiqueta="Titular de la reserva" onElegir={setTitular} />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Canal">
          <Selector value={canal?.id ?? ''} onChange={(e) => setCanalId(Number(e.target.value))}>
            {canales.data?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Selector>
        </Campo>
        {canal?.es_ota ? (
          <Campo etiqueta="Código en la agencia"><Entrada value={externo} maxLength={50} onChange={(e) => setExterno(e.target.value)} placeholder="Opcional" /></Campo>
        ) : <div />}
        <Campo etiqueta="Entrada"><Entrada type="date" value={fecha} min={diaLima(new Date())} onChange={(e) => setFecha(e.target.value)} /></Campo>
        <Campo etiqueta="Hora"><Entrada type="time" value={hora} onChange={(e) => setHora(e.target.value)} /></Campo>
        <Campo etiqueta="Turno">
          <Selector value={turno?.id ?? ''} onChange={(e) => setTurnoId(Number(e.target.value))}>
            {turnos.data?.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta={turno?.duracion_horas === 24 ? 'Noches' : 'Turnos'}><Entrada type="number" min={1} max={60} value={cantidad} onChange={(e) => setCantidad(e.target.value)} /></Campo>
        <Campo etiqueta="Adultos"><Entrada type="number" min={1} max={50} value={adultos} onChange={(e) => setAdultos(e.target.value)} /></Campo>
        <Campo etiqueta="Niños"><Entrada type="number" min={0} max={50} value={ninos} onChange={(e) => setNinos(e.target.value)} /></Campo>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs tracking-widest text-tinta-suave uppercase">
          Habitaciones libres{disp.data ? ` · salida ${fechaHoraLima(disp.data.salida)}` : ''}
        </span>
        {disp.error && <Aviso>{disp.error.message}</Aviso>}
        {fuera.length > 0 && disp.data && <Aviso>La habitación elegida ya no está libre en ese horario.</Aviso>}
        <div className="flex max-h-64 flex-col overflow-y-auto rounded-lg border border-borde text-sm">
          {disp.isLoading && <span className="px-3 py-2 text-tinta-suave">Buscando…</span>}
          {disp.data && libres.length === 0 && <span className="px-3 py-2 text-tinta-suave">No hay habitaciones libres en ese horario.</span>}
          {libres.map((h) => (
            <label key={h.id} className={clsx('flex items-center gap-3 border-b border-borde px-3 py-2 last:border-0', !h.precio && 'opacity-50')}>
              <input type="checkbox" disabled={!h.precio} checked={elegidas.includes(h.id)} onChange={(e) => setElegidas((l) => (e.target.checked ? [...l, h.id] : l.filter((x) => x !== h.id)))} />
              <span className="w-12 font-semibold tabular-nums">{h.numero}</span>
              <span className="flex-1 text-tinta-suave">{h.tipo} · {h.capacidad} pers. · {h.piso}</span>
              <span className="tabular-nums">{h.precio ? soles(h.precio) : 'sin tarifa'}</span>
            </label>
          ))}
        </div>
      </div>
      <Campo etiqueta="Observaciones"><Entrada value={observaciones} maxLength={500} onChange={(e) => setObservaciones(e.target.value)} placeholder="Opcional" /></Campo>

      <div className="rounded-lg bg-fondo p-3 text-sm">
        <div className="flex justify-between"><span>{seleccion.length} habitación(es) × {cantidadValida ? n : '—'} {turno?.duracion_horas === 24 ? 'noche(s)' : 'turno(s)'}</span><b className="tabular-nums">{total !== null ? soles(total) : '—'}</b></div>
        {seleccion.length > 0 && personas > capacidad && <p className="mt-1 text-xs text-red-700">Las habitaciones elegidas admiten {capacidad} personas.</p>}
        <p className="mt-1 text-xs text-tinta-suave">Precio de la tarifa vigente el día de entrada; queda fijo en la reserva.</p>
      </div>
      {crear.error && <Aviso>{crear.error.message}</Aviso>}
      <Button variante="primario" disabled={!listo || crear.isPending} onClick={() => crear.mutate()}>Registrar reserva</Button>
    </div>
  );
}

// ── Detalle de la reserva ───────────────────────────────────────

function DetalleReserva({ id }: { id: number }) {
  const { data: sesion } = useSesion();
  const refrescar = useRefrescarHospedaje();
  const reserva = useQuery({ queryKey: ['reserva', id], queryFn: () => api<Reserva>(`/hospedaje/reservas/${id}`) });
  const [motivo, setMotivo] = useState('');
  const [baja, setBaja] = useState<'anular' | 'no-show' | null>(null);
  const [checkin, setCheckin] = useState<OrigenCheckin | null>(null);
  const accion = useMutation({
    mutationFn: (ruta: 'confirmar' | 'anular' | 'no-show') => api<Reserva>(`/hospedaje/reservas/${id}/${ruta}`, { method: 'POST', body: JSON.stringify(ruta === 'confirmar' ? {} : { motivo }) }),
    onSuccess: () => { setBaja(null); setMotivo(''); refrescar(); },
  });
  const r = reserva.data;
  if (reserva.error) return <Aviso>{reserva.error.message}</Aviso>;
  if (!r) return <p className="text-sm text-tinta-suave">Cargando reserva…</p>;
  if (checkin) return <PanelCheckin origen={checkin} onListo={() => { setCheckin(null); refrescar(); }} />;

  const porLlegar = r.estado === 'PENDIENTE' || r.estado === 'CONFIRMADA';
  const llego = new Date() >= new Date(r.entrada);
  const diaDeEntrada = diaLima(new Date()) >= diaLima(new Date(r.entrada));
  const vigente = porLlegar || r.estado === 'EN_CURSO';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm">{r.codigo}</span>
        <Pildora className={clsx('border', ESTILO_RESERVA[r.estado].clase)}>{ESTILO_RESERVA[r.estado].etiqueta}</Pildora>
      </div>
      <div className="flex flex-col gap-1 rounded-lg border border-borde p-3 text-sm">
        <span className="font-semibold">{r.titular.nombre}</span>
        <span className="text-xs text-tinta-suave">{r.titular.documento}</span>
        <span className="mt-1">Entrada: {fechaHoraLima(r.entrada)}</span>
        <span>Salida: {fechaHoraLima(r.salida)}</span>
        <span className="text-tinta-suave">{r.adultos} adulto(s){r.ninos ? `, ${r.ninos} niño(s)` : ''} · {r.canal.nombre}{r.codigoExterno ? ` · ${r.codigoExterno}` : ''}{Number(r.comisionPorcentaje) > 0 ? ` · comisión ${r.comisionPorcentaje} %` : ''}</span>
        {r.observaciones && <span className="text-tinta-suave">{r.observaciones}</span>}
        <span className="text-xs text-tinta-suave">Registrada por {r.creadaPor} el {fechaHoraLima(r.creadaEn)}</span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs tracking-widest text-tinta-suave uppercase">Habitaciones</span>
        {r.habitaciones.map((h) => (
          <div key={h.id} className="flex items-center justify-between gap-3 rounded-lg border border-borde px-3 py-2 text-sm">
            <div className="flex flex-col">
              <span className="font-semibold">{h.numero} <span className="font-normal text-tinta-suave">· {h.tipo}</span></span>
              <span className="text-xs text-tinta-suave">{h.cantidadTurnos} × {h.turno.nombre} · {soles(h.precioUnitario)} = {soles(h.subtotal)}</span>
            </div>
            {h.estancia ? (
              <span className="text-xs font-semibold text-tinta-suave">{h.estancia.estado === 'ACTIVA' ? 'Alojado' : 'Salió'}</span>
            ) : vigente && diaDeEntrada && puede(sesion, 'estancia.checkin') ? (
              <Button
                onClick={() => setCheckin({
                  tipo: 'reserva', reservaHabitacionId: h.id, codigo: r.codigo, titularId: r.titular.id,
                  habitacion: { numero: h.numero, tipo: h.tipo, capacidad: h.capacidad }, detalle: `${h.cantidadTurnos} × ${h.turno.nombre} · ${r.canal.nombre}`,
                })}
              >
                Check-in
              </Button>
            ) : null}
          </div>
        ))}
        <div className="flex justify-between px-1 text-sm"><span>Total</span><b className="tabular-nums">{soles(r.montoTotal)}</b></div>
        {vigente && !diaDeEntrada && <p className="text-xs text-tinta-suave">El check-in se habilita el día de entrada.</p>}
      </div>

      {(r.estado === 'CANCELADA' || r.estado === 'NO_SHOW') && (
        <Aviso tipo="info">{r.estado === 'CANCELADA' ? 'Anulada' : 'No se presentó'} por {r.canceladaPor} el {r.canceladaEn ? fechaHoraLima(r.canceladaEn) : ''}: {r.motivoCancelacion}</Aviso>
      )}

      {porLlegar && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {r.estado === 'PENDIENTE' && puede(sesion, 'reserva.crear') && <Button variante="primario" disabled={accion.isPending} onClick={() => accion.mutate('confirmar')}>Confirmar</Button>}
            {puede(sesion, 'reserva.cancelar') && <Button onClick={() => setBaja('anular')}>Anular</Button>}
            {puede(sesion, 'reserva.cancelar') && llego && <Button onClick={() => setBaja('no-show')}>No se presentó</Button>}
          </div>
          {baja && (
            <div className="flex flex-col gap-2 rounded-lg border border-borde p-3">
              <Campo etiqueta={baja === 'anular' ? 'Motivo de la anulación' : 'Motivo del no-show'} ayuda="De 5 a 250 caracteres; queda registrado con tu usuario.">
                <Entrada value={motivo} maxLength={250} onChange={(e) => setMotivo(e.target.value)} autoFocus />
              </Campo>
              <div className="flex gap-2">
                <Button variante="primario" disabled={motivo.trim().length < 5 || accion.isPending} onClick={() => accion.mutate(baja)}>{baja === 'anular' ? 'Anular reserva' : 'Marcar no-show'}</Button>
                <Button variante="fantasma" onClick={() => setBaja(null)}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      )}
      {accion.error && <Aviso>{accion.error.message}</Aviso>}
    </div>
  );
}

// ── Libro de huéspedes ──────────────────────────────────────────

interface FilaLibro {
  estanciaId: number; entrada: string; salida: string | null; habitacion: string; huesped: string; documento: string; nacionalidad: string;
  fechaNacimiento: string | null; sexo: string | null; procedencia: string | null; destino: string | null; motivoViaje: string | null; titular: boolean;
}

function LibroHuespedes() {
  const hoy = diaLima(new Date());
  const [desde, setDesde] = useState(sumarDias(hoy, -6));
  const [hasta, setHasta] = useState(hoy);
  const libro = useQuery({ queryKey: ['libro', desde, hasta], queryFn: () => api<FilaLibro[]>(`/hospedaje/libro-huespedes?desde=${desde}&hasta=${hasta}`) });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Campo etiqueta="Ingreso desde"><Entrada type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></Campo>
        <Campo etiqueta="hasta"><Entrada type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} /></Campo>
        <span className="pb-2 text-xs text-tinta-suave">Hasta 31 días · {libro.data?.length ?? 0} registros</span>
      </div>
      {libro.error && <Aviso>{libro.error.message}</Aviso>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-borde bg-fondo text-left text-xs tracking-wide text-tinta-suave uppercase">
            <tr>{['Ingreso', 'Salida', 'Hab.', 'Huésped', 'Documento', 'Nacionalidad', 'Procedencia', 'Destino', 'Motivo'].map((t) => <th key={t} className="px-3 py-2 whitespace-nowrap">{t}</th>)}</tr>
          </thead>
          <tbody>
            {libro.data?.map((f) => (
              <tr key={`${f.estanciaId}-${f.documento}`} className="border-b border-borde last:border-0">
                <td className="px-3 py-2 whitespace-nowrap">{fechaHoraLima(f.entrada)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-tinta-suave">{f.salida ? fechaHoraLima(f.salida) : 'alojado'}</td>
                <td className="px-3 py-2 tabular-nums">{f.habitacion}</td>
                <td className="px-3 py-2">{f.huesped}{f.titular && <span className="ml-1 text-xs text-tinta-suave">(titular)</span>}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{f.documento}</td>
                <td className="px-3 py-2">{f.nacionalidad}</td>
                <td className="px-3 py-2">{f.procedencia ?? '—'}</td>
                <td className="px-3 py-2">{f.destino ?? '—'}</td>
                <td className="px-3 py-2">{f.motivoViaje ?? '—'}</td>
              </tr>
            ))}
            {libro.data?.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-tinta-suave">Sin ingresos en ese rango.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function ReservasPage() {
  const [pestana, setPestana] = useState<'calendario' | 'libro'>('calendario');
  const [panel, setPanel] = useState<Panel | null>(null);
  const titulo = !panel ? '' : panel.tipo === 'nueva' ? 'Nueva reserva' : panel.tipo === 'reserva' ? 'Reserva' : 'Estancia';
  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="text-xs text-tinta-suave">Hotel / Reservas</div>
        <h1 className="text-2xl font-bold">Reservas</h1>
      </header>
      <Pestanas opciones={[{ id: 'calendario', texto: 'Calendario' }, { id: 'libro', texto: 'Libro de huéspedes' }]} valor={pestana} onCambio={setPestana} />
      {pestana === 'calendario' ? <VistaCalendario onPanel={setPanel} /> : <LibroHuespedes />}
      <PanelLateral titulo={titulo} abierto={panel !== null} onCerrar={() => setPanel(null)}>
        {panel?.tipo === 'nueva' && <NuevaReserva key={`${panel.habitacionId}-${panel.dia}`} habitacionId={panel.habitacionId} dia={panel.dia} onCreada={(r) => setPanel({ tipo: 'reserva', id: r.id })} />}
        {panel?.tipo === 'reserva' && <DetalleReserva key={panel.id} id={panel.id} />}
        {panel?.tipo === 'estancia' && <PanelEstancia key={panel.id} estanciaId={panel.id} />}
      </PanelLateral>
    </div>
  );
}
