import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type Estado, type HabitacionTablero, type Reserva, type Tablero } from '../lib/api';
import { accionHacia, ESTADOS, ESTILO_ESTADO, tiempoRestante } from '../features/hospedaje/estados';
import { useTableroEnVivo } from '../features/hospedaje/useTableroEnVivo';
import { puede, useSesion } from '../features/auth/sesion';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Aviso, PanelLateral } from '../components/ui/form';
import { PanelCheckin, PanelEstancia, type OrigenCheckin } from '../components/hospedaje/estancias';
import { fechaHoraLima, horaLima } from '../features/hospedaje/reservas';
import { soles } from '../features/hospedaje/formato';

const hora = (iso: string) => new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function TarjetaHabitacion({ h, onClick, seleccionada }: { h: HabitacionTablero; onClick: () => void; seleccionada: boolean }) {
  const e = ESTILO_ESTADO[h.estado];
  const alerta = h.estancia?.alerta;
  return (
    <button
      onClick={onClick}
      className={clsx(
        'relative flex min-h-[112px] flex-col gap-1 rounded-xl border-2 p-3 text-left transition-shadow hover:shadow-md',
        e.fondo, e.borde, seleccionada && 'ring-2 ring-acento ring-offset-2',
      )}
    >
      <span className="text-xl leading-none font-bold tabular-nums">{h.numero}</span>
      <span className={clsx('flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase', e.texto)}>
        <span className={clsx('h-2 w-2 flex-none rounded-full', e.punto)} />
        {e.etiqueta}
      </span>
      <span className="text-xs text-tinta-suave">{h.tipo} · {h.capacidad} pers.</span>
      {!h.estancia && h.llegada && (
        <div className="mt-auto flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{h.llegada.titular}</span>
          <span className="text-xs font-semibold text-reservada">Llega hoy {horaLima(h.llegada.entrada)}</span>
        </div>
      )}
      {h.estancia && (
        <div className="mt-auto flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{h.estancia.huesped ?? 'Huésped'}</span>
          <span className={clsx('text-xs', alerta === 'VENCIDA' ? 'font-semibold text-ocupada' : alerta === 'POR_VENCER' ? 'font-semibold text-limpieza' : 'text-tinta-suave')}>
            {tiempoRestante(new Date(h.estancia.salidaPrevista), new Date())}
          </span>
        </div>
      )}
      {alerta && (
        <span className={clsx('absolute -top-2 -right-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white', alerta === 'VENCIDA' ? 'bg-ocupada' : 'bg-limpieza')}>
          {alerta === 'VENCIDA' ? 'VENCIDA' : 'POR VENCER'}
        </span>
      )}
    </button>
  );
}

function PanelHabitacion({ h, onCerrar }: { h: HabitacionTablero; onCerrar: () => void }) {
  const qc = useQueryClient();
  const { data: sesion } = useSesion();
  const [motivo, setMotivo] = useState('');
  const historial = useQuery({
    queryKey: ['historial', h.id],
    queryFn: () => api<Array<{ id: number; fecha: string; motivo: string | null; usuario: string | null; desde: Estado | null; hacia: Estado }>>(`/hospedaje/habitaciones/${h.id}/historial`),
  });
  const cambiar = useMutation({
    mutationFn: (estado: Estado) => api(`/hospedaje/habitaciones/${h.id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado, motivo: motivo || undefined }) }),
    onSuccess: () => {
      setMotivo('');
      qc.invalidateQueries({ queryKey: ['tablero'] });
      qc.invalidateQueries({ queryKey: ['historial', h.id] });
    },
  });
  const e = ESTILO_ESTADO[h.estado];
  const puedeCambiar = puede(sesion, 'habitacion.cambiar_estado');
  const admiteCheckin = h.estado === 'DESOCUPADA' || h.estado === 'RESERVADA' || h.estado === 'CONFIRMADA';
  const [checkin, setCheckin] = useState<'reserva' | 'walkin' | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  const reserva = useQuery({
    queryKey: ['reserva', h.llegada?.reservaId],
    queryFn: () => api<Reserva>(`/hospedaje/reservas/${h.llegada!.reservaId}`),
    enabled: checkin === 'reserva' && Boolean(h.llegada),
  });
  const rh = reserva.data?.habitaciones.find((x) => x.id === h.llegada?.reservaHabitacionId);
  const origen: OrigenCheckin | null =
    checkin === 'walkin'
      ? { tipo: 'walkin', habitacion: { id: h.id, numero: h.numero, tipo: h.tipo, capacidad: h.capacidad } }
      : checkin === 'reserva' && reserva.data && rh
        ? {
            tipo: 'reserva',
            reservaHabitacionId: rh.id,
            codigo: reserva.data.codigo,
            titularId: reserva.data.titular.id,
            habitacion: { numero: rh.numero, tipo: rh.tipo, capacidad: rh.capacidad },
            detalle: `${rh.cantidadTurnos} × ${rh.turno.nombre} · ${reserva.data.canal.nombre}`,
          }
        : null;

  return (
    <Card className="flex flex-col gap-5 p-5 xl:sticky xl:top-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs tracking-widest text-tinta-suave uppercase">Habitación</div>
          <div className="text-3xl font-bold tabular-nums">{h.numero}</div>
          <div className="text-sm text-tinta-suave">{h.tipo} · {h.capacidad} personas</div>
        </div>
        <button onClick={onCerrar} className="text-sm text-tinta-suave hover:text-tinta" aria-label="Cerrar panel">Cerrar</button>
      </div>

      <div className={clsx('flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold', e.fondo, e.texto)}>
        <span className={clsx('h-2.5 w-2.5 rounded-full', e.punto)} /> {e.etiqueta}
      </div>

      {listo && <Aviso tipo="ok">{listo}</Aviso>}
      {h.estancia && (
        <PanelEstancia
          estanciaId={h.estancia.id}
          onSalida={(l) => setListo(`Check-out registrado: ${l.consumidos} turno(s) × ${soles(l.precioUnitario)} = ${soles(l.importe)}. La habitación pasó a limpieza; el cobro se hará desde Ventas (fase F3).`)}
        />
      )}

      {!h.estancia && admiteCheckin && puede(sesion, 'estancia.checkin') && (
        <div className="flex flex-col gap-2">
          <span className="text-xs tracking-widest text-tinta-suave uppercase">Check-in</span>
          {h.llegada && (
            <div className="rounded-lg border border-reservada/40 bg-reservada/8 px-3 py-2 text-sm">
              <div className="font-semibold">{h.llegada.titular}</div>
              <div className="text-xs text-tinta-suave">Reserva {h.llegada.codigo} · llega {fechaHoraLima(h.llegada.entrada)}</div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {h.llegada && <Button variante="primario" onClick={() => setCheckin('reserva')}>Check-in de la reserva</Button>}
            <Button variante={h.llegada ? 'secundario' : 'primario'} onClick={() => setCheckin('walkin')}>Check-in sin reserva</Button>
          </div>
        </div>
      )}

      {puedeCambiar ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs tracking-widest text-tinta-suave uppercase">Cambiar estado</span>
          <input
            id="motivo"
            className="h-9 rounded-lg border border-borde px-3 text-sm"
            placeholder="Motivo (opcional), ej. limpieza terminada"
            value={motivo}
            onChange={(ev) => setMotivo(ev.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {h.siguientes.map((s) => (
              <Button key={s} onClick={() => cambiar.mutate(s)} disabled={cambiar.isPending}>
                <span className={clsx('h-2 w-2 rounded-full', ESTILO_ESTADO[s].punto)} />
                {accionHacia(s)}
              </Button>
            ))}
          </div>
          {h.siguientes.length === 0 && <p className="text-xs text-tinta-suave">{h.estancia ? 'Con una estancia en curso, la habitación se libera con el check-out.' : 'Sin cambios disponibles.'}</p>}
          {cambiar.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{cambiar.error.message}</p>}
        </div>
      ) : (
        <p className="text-sm text-tinta-suave">Tu rol solo puede consultar esta habitación.</p>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-xs tracking-widest text-tinta-suave uppercase">Historial de estados</span>
        {historial.data?.length === 0 && <p className="text-sm text-tinta-suave">Sin cambios registrados.</p>}
        <ol className="flex flex-col gap-2">
          {historial.data?.slice(0, 6).map((x) => (
            <li key={x.id} className="flex flex-col border-l-2 border-borde pl-3 text-sm">
              <span>
                {x.desde ? ESTILO_ESTADO[x.desde].etiqueta : '—'} → <b>{ESTILO_ESTADO[x.hacia].etiqueta}</b>
              </span>
              <span className="text-xs text-tinta-suave">
                {hora(x.fecha)} · {x.usuario ?? 'sistema'}{x.motivo ? ` · ${x.motivo}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <PanelLateral titulo={`Check-in · habitación ${h.numero}`} abierto={checkin !== null} onCerrar={() => setCheckin(null)}>
        {origen ? (
          <PanelCheckin origen={origen} onListo={(est) => { setCheckin(null); setListo(`Check-in registrado: ${est.huespedes[0]?.nombre ?? ''}.`); }} />
        ) : (
          <p className="text-sm text-tinta-suave">{reserva.error ? reserva.error.message : 'Cargando reserva…'}</p>
        )}
      </PanelLateral>
    </Card>
  );
}

export function TableroPage() {
  const [filtro, setFiltro] = useState<Estado | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: ['tablero'],
    queryFn: () => api<Tablero>('/hospedaje/tablero'),
    refetchInterval: 60_000, // respaldo: los cambios llegan por el flujo en vivo (S-05 D6)
  });
  const conexion = useTableroEnVivo(); // RF-RES-05: el tablero se actualiza solo, sin recargar la página
  const enVivo = conexion === 'en-vivo';
  const todas = data?.pisos.flatMap((p) => p.habitaciones) ?? [];
  const sel = todas.find((h) => h.id === selId) ?? null;
  const total = todas.length;
  const ocupadas = data?.resumen.OCUPADA ?? 0;
  const alertas = todas.filter((h) => h.estancia?.alerta).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs text-tinta-suave">Hotel / Tablero</div>
          <h1 className="text-2xl font-bold">Tablero de habitaciones</h1>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-tinta-suave" role="status">
          <span className={clsx('h-2 w-2 flex-none rounded-full', enVivo ? 'bg-desocupada' : 'bg-limpieza')} />
          <span className={clsx('font-semibold', enVivo ? 'text-desocupada' : 'text-limpieza')}>
            {{ 'en-vivo': 'En vivo', respaldo: 'Actualizando cada minuto', reconectando: 'Reconectando…', conectando: 'Conectando…' }[conexion]}
          </span>
          <span>· última lectura {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('es-PE') : '—'}</span>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4"><div className="text-2xl font-bold tabular-nums">{total}</div><div className="text-xs text-tinta-suave">Habitaciones</div></Card>
        <Card className="p-4"><div className="text-2xl font-bold tabular-nums">{total ? Math.round((ocupadas / total) * 100) : 0}%</div><div className="text-xs text-tinta-suave">Ocupación ahora ({ocupadas} ocupadas)</div></Card>
        <Card className="p-4"><div className="text-2xl font-bold tabular-nums">{data?.resumen.DESOCUPADA ?? 0}</div><div className="text-xs text-tinta-suave">Disponibles para vender</div></Card>
        <Card className={clsx('p-4', alertas > 0 && 'border-ocupada/50 bg-ocupada/5')}><div className={clsx('text-2xl font-bold tabular-nums', alertas > 0 && 'text-ocupada')}>{alertas}</div><div className="text-xs text-tinta-suave">Salidas vencidas o por vencer</div></Card>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
        <Button variante={filtro === null ? 'primario' : 'secundario'} onClick={() => setFiltro(null)}>Todas · {total}</Button>
        {ESTADOS.map((s) => (
          <Button key={s} variante={filtro === s ? 'primario' : 'secundario'} onClick={() => setFiltro(filtro === s ? null : s)}>
            <span className={clsx('h-2 w-2 rounded-full', ESTILO_ESTADO[s].punto)} />
            {ESTILO_ESTADO[s].etiqueta} · {data?.resumen[s] ?? 0}
          </Button>
        ))}
      </div>

      {isLoading && <p className="text-tinta-suave">Cargando habitaciones…</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error.message}</p>}

      <div className={clsx('grid gap-6', sel && 'xl:grid-cols-[1fr_360px]')}>
        <div className="flex min-w-0 flex-col gap-6">
          {data?.pisos.map((p) => {
            const habs = p.habitaciones.filter((h) => !filtro || h.estado === filtro);
            if (!habs.length) return null;
            return (
              <section key={p.id} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold tracking-widest text-tinta-suave uppercase">{p.nombre}</h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                  {habs.map((h) => (
                    <TarjetaHabitacion key={h.id} h={h} seleccionada={h.id === selId} onClick={() => setSelId(h.id === selId ? null : h.id)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        {sel && <PanelHabitacion key={sel.id} h={sel} onCerrar={() => setSelId(null)} />}
      </div>
    </div>
  );
}
