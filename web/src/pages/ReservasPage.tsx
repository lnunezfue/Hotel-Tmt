import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import clsx from 'clsx';
import { api, type Cliente, type EstadoReserva, type Reserva, type Tablero } from '../lib/api';
import { puede, useSesion } from '../features/auth/sesion';
import { soles } from '../features/hospedaje/formato';
import { diaCorto, fechaDe, horaLima, hoyLima, posicionEnDias, sumarDias } from '../features/reservas/fechas';
import { ElegirHuesped, PanelNuevaReserva, type InicialReserva } from '../features/reservas/PanelNuevaReserva';
import { CajonEstancia } from '../features/estancias/Cajones';
import { useOperacion } from '../features/hospedaje/operacion';
import { esEmpresa, MOTIVOS_VIAJE } from '../features/estancias/libro';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Aviso, Campo, Entrada, PanelLateral, Pildora, Selector } from '../components/ui/form';

const DIAS = 14;
const ANCHO_HAB = 112;

const ESTILO: Record<EstadoReserva, { texto: string; barra: string; pildora: string }> = {
  PENDIENTE: { texto: 'Pendiente', barra: 'border-2 border-dashed border-reservada bg-reservada/10 text-reservada', pildora: 'bg-reservada/10 text-reservada' },
  CONFIRMADA: { texto: 'Confirmada', barra: 'border border-confirmada bg-confirmada text-white', pildora: 'bg-confirmada/15 text-confirmada' },
  EN_CURSO: { texto: 'En curso', barra: 'border border-ocupada bg-ocupada text-white', pildora: 'bg-ocupada/10 text-ocupada' },
  FINALIZADA: { texto: 'Finalizada', barra: 'border border-borde bg-fondo text-tinta-suave', pildora: 'bg-fondo text-tinta-suave' },
  CANCELADA: { texto: 'Cancelada', barra: 'border border-borde bg-fondo text-tinta-suave line-through', pildora: 'bg-fondo text-tinta-suave' },
  NO_SHOW: { texto: 'No se presentó', barra: 'border border-borde bg-fondo text-tinta-suave', pildora: 'bg-limpieza/15 text-limpieza' },
};

function DetalleReserva({ r, onListo }: { r: Reserva; onListo: (msg: string) => void }) {
  const qc = useQueryClient();
  const { data: sesion } = useSesion();
  const op = useOperacion().data;
  const [motivo, setMotivo] = useState('');
  const [baja, setBaja] = useState<'cancelar' | 'no-show' | null>(null);
  const [procedencia, setProcedencia] = useState('');
  const [destino, setDestino] = useState('');
  const [motivoViaje, setMotivoViaje] = useState<string>('Turismo');
  // Si reservó una empresa, en cada habitación se registra quién se aloja (una empresa no se aloja).
  const [titulares, setTitulares] = useState<Record<number, Cliente>>({});
  const [acomp, setAcomp] = useState<Record<number, Cliente[]>>({});
  const [eligiendo, setEligiendo] = useState<number | null>(null);
  const [cajon, setCajon] = useState<{ id: number; numero: string } | null>(null);
  const accion = useMutation({
    mutationFn: ({ ruta, cuerpo }: { ruta: string; cuerpo?: unknown }) => api<Reserva>(`/reservas/${r.id}/${ruta}`, { method: 'POST', body: cuerpo ? JSON.stringify(cuerpo) : undefined }),
    onSuccess: (x, { ruta }) => {
      qc.invalidateQueries({ queryKey: ['reservas'] });
      qc.invalidateQueries({ queryKey: ['tablero'] });
      qc.invalidateQueries({ queryKey: ['plano'] });
      const textos: Record<string, string> = { confirmar: 'confirmada', cancelar: 'cancelada', 'no-show': 'marcada como no presentada', checkin: `en curso: check-in hecho en la ${x.habitaciones[0]?.numero}` };
      onListo(`Reserva ${x.codigo} ${textos[ruta]}.`);
    },
  });
  const abierta = r.estado === 'PENDIENTE' || r.estado === 'CONFIRMADA';
  const llegaHoyOAntes = fechaDe(r.entrada) <= hoyLima();
  const reservoEmpresa = esEmpresa(r.cliente.documento);
  const faltanTitulares = reservoEmpresa && r.habitaciones.some((hab) => !titulares[hab.id]);
  const h = r.habitaciones[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm text-tinta-suave">{r.codigo}{r.codigoExterno ? ` · ${r.codigoExterno}` : ''}</span>
        <Pildora className={ESTILO[r.estado].pildora}>{ESTILO[r.estado].texto}</Pildora>
      </div>
      <div>
        <div className="text-lg font-semibold">{r.cliente.nombre}</div>
        <div className="text-sm text-tinta-suave">{r.cliente.documento}{r.cliente.telefono ? ` · ${r.cliente.telefono}` : ''} · {r.cliente.pais}</div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-fondo p-2"><div className="text-xs text-tinta-suave">Llega</div><b>{horaLima(r.entrada)}</b></div>
        <div className="rounded-lg bg-fondo p-2"><div className="text-xs text-tinta-suave">Sale</div><b>{horaLima(r.salida)}</b></div>
        <div className="rounded-lg bg-fondo p-2"><div className="text-xs text-tinta-suave">{r.habitaciones.length > 1 ? 'Habitaciones' : 'Habitación'}</div><b>{r.habitaciones.map((x) => x.numero).join(', ')}</b>{r.habitaciones.length === 1 ? ` · ${h?.tipo}` : ''}</div>
        <div className="rounded-lg bg-fondo p-2"><div className="text-xs text-tinta-suave">Personas</div><b>{r.adultos}</b> adultos{r.ninos ? ` + ${r.ninos} niños` : ''}</div>
      </div>
      <div className="rounded-lg border border-borde p-3 text-sm">
        {r.habitaciones.map((x) => (
          <div key={x.id} className="flex justify-between"><span>{x.numero}: {x.cantidad} × {x.horasTurno === 24 ? 'noche' : `turno de ${x.horasTurno} h`} a {soles(x.precio)}</span><span className="tabular-nums">{soles(Number(x.precio) * x.cantidad)}</span></div>
        ))}
        <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{soles(r.total)}</span></div>
        <div className="flex justify-between text-tinta-suave"><span>Adelanto</span><span className="tabular-nums">{soles(r.adelanto)}</span></div>
        <div className="flex justify-between font-semibold text-acento"><span>Saldo por cobrar</span><span className="tabular-nums">{soles(r.saldo)}</span></div>
      </div>
      {Number(r.comision.monto) > 0 && <p className="text-xs text-tinta-suave">Comisión de {r.canal.nombre} ({Number(r.comision.porcentaje)} %): {soles(r.comision.monto)}, fijada al reservar.</p>}
      {r.estado === 'EN_CURSO' && (
        <Button variante="primario" onClick={() => setCajon({ id: r.habitaciones[0].id, numero: r.habitaciones[0].numero })}>Ver estadía: cobro y check-out</Button>
      )}
      <CajonEstancia habitacionId={cajon?.id ?? null} numero={cajon?.numero} onCerrar={() => setCajon(null)} />
      {r.observaciones && <p className="rounded-lg bg-acento-suave/50 p-2 text-sm">{r.observaciones}</p>}
      {r.motivoCancelacion && (
        <p className="text-sm text-tinta-suave">
          Motivo: {r.motivoCancelacion}
          {r.canceladaPor && ` · ${r.canceladaPor}${r.canceladaEn ? `, ${horaLima(r.canceladaEn)}` : ''}`}
        </p>
      )}
      {accion.error && <Aviso>{accion.error.message}</Aviso>}

      {abierta && (
        <div className="flex flex-col gap-2 border-t border-borde pt-4">
          {llegaHoyOAntes && puede(sesion, 'estancia.checkin') && (
            <div className="flex flex-col gap-3 rounded-lg bg-desocupada/8 p-3">
              <span className="text-sm font-semibold">Check-in: ¿quién se queda en cada habitación?</span>
              {r.habitaciones.map((hab) => (
                <div key={hab.id} className="flex flex-col gap-1 rounded-md bg-white p-2 text-sm">
                  <b>Habitación {hab.numero} · {hab.tipo}</b>
                  {reservoEmpresa ? (
                    titulares[hab.id] ? (
                      <span className="flex justify-between text-xs">Titular: {titulares[hab.id].nombre}<button className="text-tinta-suave" onClick={() => { const t = { ...titulares }; delete t[hab.id]; setTitulares(t); }}>Cambiar</button></span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-ocupada">Reservó {r.cliente.nombre}: indica quién se aloja</span>
                        <ElegirHuesped valor={null} onCambio={(c) => { if (c) setTitulares({ ...titulares, [hab.id]: c }); }} />
                      </div>
                    )
                  ) : (
                    <span className="text-xs text-tinta-suave">Titular: {r.cliente.nombre}</span>
                  )}
                  {(acomp[hab.id] ?? []).map((a) => (
                    <span key={a.id} className="flex justify-between text-xs">+ {a.nombre}<button className="text-tinta-suave" onClick={() => setAcomp({ ...acomp, [hab.id]: acomp[hab.id].filter((x) => x.id !== a.id) })}>Quitar</button></span>
                  ))}
                  {eligiendo === hab.id ? (
                    <ElegirHuesped valor={null} onCambio={(c) => { if (c) setAcomp({ ...acomp, [hab.id]: [...(acomp[hab.id] ?? []), c] }); setEligiendo(null); }} />
                  ) : (
                    <button className="self-start text-xs font-medium text-acento hover:underline" onClick={() => setEligiendo(hab.id)}>+ Acompañante</button>
                  )}
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2">
                <Campo etiqueta="Procedencia"><Entrada value={procedencia} onChange={(e) => setProcedencia(e.target.value)} placeholder="Ciudad o país" /></Campo>
                <Campo etiqueta="Destino (opcional)"><Entrada value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="A dónde sigue" /></Campo>
                <Campo etiqueta="Motivo del viaje" className="col-span-2">
                  <Selector value={motivoViaje} onChange={(e) => setMotivoViaje(e.target.value)}>
                    {MOTIVOS_VIAJE.map((m) => <option key={m}>{m}</option>)}
                  </Selector>
                </Campo>
              </div>
              <span className="text-xs text-tinta-suave">Procedencia, destino y motivo van al libro de registro de huéspedes.</span>
              {op?.cobroAlIngreso && <span className="text-xs text-tinta-suave">El tiempo corre desde que llegan. Después del check-in, cobra el pago adelantado con «Ver estadía» → «Cobrar».</span>}
              <Button
                variante="primario"
                disabled={accion.isPending || procedencia.trim().length < 2 || faltanTitulares}
                onClick={() =>
                  accion.mutate({
                    ruta: 'checkin',
                    cuerpo: {
                      procedencia,
                      destino: destino || null,
                      motivoViaje,
                      huespedes: r.habitaciones.map((hab) => ({ habitacionId: hab.id, titularId: titulares[hab.id]?.id, acompanantes: (acomp[hab.id] ?? []).map((a) => a.id) })),
                    },
                  })
                }
              >
                Hacer check-in{r.habitaciones.length > 1 ? ` de ${r.habitaciones.length} habitaciones` : ''}
              </Button>
            </div>
          )}
          {r.estado === 'PENDIENTE' && puede(sesion, 'reserva.crear') && <Button disabled={accion.isPending} onClick={() => accion.mutate({ ruta: 'confirmar' })}>Confirmar reserva</Button>}
          {puede(sesion, 'reserva.cancelar') && (
            <>
              {baja ? (
                <div className="flex flex-col gap-2">
                  <Entrada value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={baja === 'cancelar' ? 'Motivo de la cancelación' : 'Qué pasó (ej. no llegó ni avisó)'} autoFocus />
                  <span className="text-xs text-tinta-suave">Queda registrado con tu usuario.</span>
                  <div className="flex gap-2">
                    <Button className="text-ocupada" disabled={motivo.trim().length < 3 || accion.isPending} onClick={() => accion.mutate({ ruta: baja, cuerpo: { motivo } })}>
                      {baja === 'cancelar' ? 'Cancelar reserva' : 'Marcar «no se presentó»'}
                    </Button>
                    <Button variante="fantasma" onClick={() => setBaja(null)}>Volver</Button>
                  </div>
                </div>
              ) : (
                <>
                  {llegaHoyOAntes && <Button disabled={accion.isPending} onClick={() => { setMotivo(''); setBaja('no-show'); }}>No se presentó…</Button>}
                  <Button variante="fantasma" className="text-ocupada" onClick={() => { setMotivo(''); setBaja('cancelar'); }}>Cancelar reserva…</Button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ReservasPage() {
  const navigate = useNavigate();
  const { data: sesion } = useSesion();
  const hoy = hoyLima();
  const [inicio, setInicio] = useState(sumarDias(hoy, -1));
  const fin = sumarDias(inicio, DIAS - 1);
  const reservas = useQuery({ queryKey: ['reservas', 'lista', inicio, fin], queryFn: () => api<Reserva[]>(`/reservas?desde=${inicio}&hasta=${fin}`), refetchInterval: 30_000 });
  const tablero = useQuery({ queryKey: ['tablero'], queryFn: () => api<Tablero>('/hospedaje/tablero') });
  const [nueva, setNueva] = useState<InicialReserva | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [buscar, setBuscar] = useState('');
  const sel = reservas.data?.find((r) => r.id === selId) ?? null;
  const dias = useMemo(() => Array.from({ length: DIAS }, (_, i) => sumarDias(inicio, i)), [inicio]);
  const puedeCrear = puede(sesion, 'reserva.crear');

  const visibles = (reservas.data ?? []).filter((r) => !buscar.trim() || `${r.codigo} ${r.cliente.nombre} ${r.cliente.documento} ${r.codigoExterno ?? ''}`.toLowerCase().includes(buscar.trim().toLowerCase()));
  const llegadasHoy = (reservas.data ?? []).filter((r) => fechaDe(r.entrada) === hoy && (r.estado === 'PENDIENTE' || r.estado === 'CONFIRMADA'));
  const salidasHoy = (reservas.data ?? []).filter((r) => fechaDe(r.salida) === hoy && r.estado === 'EN_CURSO');
  const pendientes = (reservas.data ?? []).filter((r) => r.estado === 'PENDIENTE').length;
  const ingresos = (reservas.data ?? []).filter((r) => r.estado !== 'NO_SHOW').reduce((s, r) => s + Number(r.total), 0);

  const barra = (desde: string, hasta: string) => {
    const a = Math.max(0, posicionEnDias(desde, inicio));
    const b = Math.min(DIAS, posicionEnDias(hasta, inicio));
    return b <= 0 || a >= DIAS ? null : { left: `calc(${(a / DIAS) * 100}% + 1px)`, width: `calc(${((b - a) / DIAS) * 100}% - 2px)` };
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs text-tinta-suave">Hotel / Reservas</div>
          <h1 className="text-2xl font-bold">Reservas</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate('/plano?modo=reservar')}>Reservar sobre el plano</Button>
          {puedeCrear && <Button variante="primario" onClick={() => setNueva({ llegada: hoy })}>+ Nueva reserva</Button>}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className={clsx('p-4', llegadasHoy.length > 0 && 'border-reservada/40 bg-reservada/5')}><div className="text-2xl font-bold tabular-nums">{llegadasHoy.length}</div><div className="text-xs text-tinta-suave">Llegan hoy</div></Card>
        <Card className="p-4"><div className="text-2xl font-bold tabular-nums">{salidasHoy.length}</div><div className="text-xs text-tinta-suave">Salen hoy (con reserva)</div></Card>
        <Card className="p-4"><div className="text-2xl font-bold tabular-nums">{pendientes}</div><div className="text-xs text-tinta-suave">Pendientes de confirmar</div></Card>
        <Card className="p-4"><div className="text-2xl font-bold tabular-nums">{soles(ingresos)}</div><div className="text-xs text-tinta-suave">Reservado en estas 2 semanas</div></Card>
      </div>

      {llegadasHoy.length > 0 && (
        <Card className="flex flex-wrap items-center gap-2 p-3">
          <span className="text-sm font-semibold">Llegan hoy:</span>
          {llegadasHoy.map((r) => (
            <button key={r.id} onClick={() => setSelId(r.id)} className="flex items-center gap-2 rounded-lg border border-borde bg-white px-3 py-1.5 text-sm hover:border-acento">
              <b className="tabular-nums">{r.habitaciones[0]?.numero}</b> {r.cliente.nombre}
              <Pildora className={ESTILO[r.estado].pildora}>{ESTILO[r.estado].texto}</Pildora>
            </button>
          ))}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setInicio(sumarDias(inicio, -7))} aria-label="Semana anterior">←</Button>
        <Button onClick={() => setInicio(sumarDias(hoy, -1))}>Hoy</Button>
        <Button onClick={() => setInicio(sumarDias(inicio, 7))} aria-label="Semana siguiente">→</Button>
        <span className="text-sm text-tinta-suave">{diaCorto(inicio).dia} {diaCorto(inicio).mes} – {diaCorto(fin).dia} {diaCorto(fin).mes}</span>
        <Entrada placeholder="Buscar por código, huésped o documento" value={buscar} onChange={(e) => setBuscar(e.target.value)} className="ml-auto max-w-xs" aria-label="Buscar reservas" />
      </div>
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {reservas.error && <Aviso>{reservas.error.message}</Aviso>}

      <Card className="overflow-x-auto">
        <div className="min-w-[980px]">
          <div className="sticky top-0 z-10 flex border-b border-borde bg-fondo text-xs">
            <div className="flex-none px-3 py-2 font-semibold tracking-wide text-tinta-suave uppercase" style={{ width: ANCHO_HAB }}>Habitación</div>
            <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${DIAS}, 1fr)` }}>
              {dias.map((d) => {
                const c = diaCorto(d);
                const finde = [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
                return (
                  <div key={d} className={clsx('border-l border-borde px-1 py-1.5 text-center leading-tight', d === hoy && 'bg-acento/10 font-bold text-acento', finde && d !== hoy && 'bg-tinta/[0.03]')}>
                    <div className="capitalize">{c.semana}</div><div className="text-sm font-semibold tabular-nums">{c.dia}</div>
                  </div>
                );
              })}
            </div>
          </div>
          {tablero.data?.pisos.map((p) => (
            <div key={p.id}>
              <div className="border-b border-borde bg-white px-3 py-1 text-[11px] font-semibold tracking-widest text-tinta-suave uppercase">{p.nombre}</div>
              {p.habitaciones.map((h) => {
                const suyas = visibles.filter((r) => r.habitaciones.some((x) => x.id === h.id) && r.estado !== 'CANCELADA');
                const conReserva = suyas.some((r) => r.estado === 'EN_CURSO');
                return (
                  <div key={h.id} className="flex h-12 border-b border-borde last:border-0">
                    <div className="flex flex-none flex-col justify-center px-3" style={{ width: ANCHO_HAB }}>
                      <span className="text-sm font-semibold tabular-nums">{h.numero}</span>
                      <span className="truncate text-[11px] text-tinta-suave">{h.tipo}</span>
                    </div>
                    <div className="relative grid flex-1" style={{ gridTemplateColumns: `repeat(${DIAS}, 1fr)` }}>
                      {dias.map((d) => (
                        <button
                          key={d}
                          disabled={!puedeCrear || d < hoy}
                          onClick={() => setNueva({ habitacionId: h.id, llegada: d, noches: 1 })}
                          className={clsx('border-l border-borde', d === hoy && 'bg-acento/5', puedeCrear && d >= hoy && 'hover:bg-desocupada/10')}
                          aria-label={`Reservar ${h.numero} desde ${d}`}
                        />
                      ))}
                      {/* Estancia sin reserva (huésped que llegó directo) */}
                      {h.estancia && !conReserva && (() => {
                        const st = barra(h.estancia.checkin, h.estancia.salidaPrevista);
                        return st ? (
                          <div className="pointer-events-none absolute top-1.5 bottom-1.5 flex items-center overflow-hidden rounded-md border border-ocupada/60 bg-ocupada/15 px-2 text-[11px] font-medium text-ocupada" style={st} title="Estancia en curso (sin reserva previa)">
                            <span className="truncate">{h.estancia.huesped ?? 'Ocupada'}</span>
                          </div>
                        ) : null;
                      })()}
                      {suyas.map((r) => {
                        const st = barra(r.entrada, r.salida);
                        if (!st) return null;
                        return (
                          <button
                            key={r.id}
                            onClick={() => setSelId(r.id)}
                            className={clsx('absolute top-1.5 bottom-1.5 flex items-center gap-1 overflow-hidden rounded-md px-2 text-left text-[11px] font-medium shadow-sm', ESTILO[r.estado].barra, r.id === selId && 'ring-2 ring-acento ring-offset-1')}
                            style={st}
                            title={`${r.codigo} · ${r.cliente.nombre} · ${ESTILO[r.estado].texto} · ${r.canal.nombre}`}
                          >
                            {r.canal.esOta && <span className="rounded bg-white/25 px-1 text-[9px] font-bold">OTA</span>}
                            <span className="truncate">{r.cliente.nombre}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-4 border-t border-borde px-3 py-2 text-xs text-tinta-suave">
          {(['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'] as EstadoReserva[]).map((e) => <span key={e} className="flex items-center gap-1.5"><span className={clsx('h-3 w-6 rounded', ESTILO[e].barra)} />{ESTILO[e].texto}</span>)}
          <span className="flex items-center gap-1.5"><span className="h-3 w-6 rounded border border-ocupada/60 bg-ocupada/15" />Ocupada sin reserva</span>
          <span className="ml-auto">Clic en un día libre para reservar · el sistema no permite fechas que se cruzan.</span>
        </div>
      </Card>

      <PanelLateral titulo="Nueva reserva" abierto={!!nueva} onCerrar={() => setNueva(null)}>
        {nueva && <PanelNuevaReserva key={JSON.stringify(nueva)} inicial={nueva} onListo={(r) => { setNueva(null); setSelId(r.id); setAviso(`Reserva ${r.codigo} registrada para ${r.cliente.nombre}.`); }} />}
      </PanelLateral>
      <PanelLateral titulo={sel ? `Reserva ${sel.codigo}` : 'Reserva'} abierto={!!sel && !nueva} onCerrar={() => setSelId(null)}>
        {sel && <DetalleReserva key={sel.id} r={sel} onListo={(m) => { setAviso(m); }} />}
      </PanelLateral>
    </div>
  );
}
