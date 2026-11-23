import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type Cliente, type Disponibilidad, type Reserva } from '../../lib/api';
import { soles } from '../hospedaje/formato';
import { Button } from '../../components/ui/Button';
import { Aviso, Campo, Entrada, Selector } from '../../components/ui/form';
import { hoyLima } from './fechas';

interface Canal { id: number; nombre: string; esOta?: boolean; es_ota?: boolean; activo?: boolean }
interface Turno { id: number; nombre: string; duracion_horas: number }
interface TipoDoc { id: number; abreviatura: string; descripcion: string }

const json = (cuerpo: unknown) => ({ method: 'POST', body: JSON.stringify(cuerpo) });

/** Búsqueda de huésped por documento o nombre, con alta rápida si no existe. */
function ElegirHuesped({ valor, onCambio }: { valor: Cliente | null; onCambio: (c: Cliente | null) => void }) {
  const [q, setQ] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const [diferida, setDiferida] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDiferida(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const resultados = useQuery({ queryKey: ['clientes', diferida], queryFn: () => api<Cliente[]>(`/clientes?q=${encodeURIComponent(diferida)}`), enabled: diferida.trim().length >= 2 && !valor });
  const tipos = useQuery({ queryKey: ['tipos-documento'], queryFn: () => api<TipoDoc[]>('/clientes/tipos-documento'), enabled: nuevo });
  const [tipoId, setTipoId] = useState<number | ''>('');
  const [numero, setNumero] = useState('');
  const [nombres, setNombres] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [razon, setRazon] = useState('');
  const [telefono, setTelefono] = useState('');
  const [pais, setPais] = useState('PE');
  const tipo = tipos.data?.find((t) => t.id === tipoId) ?? tipos.data?.find((t) => t.abreviatura === 'DNI');
  const esEmpresa = tipo?.abreviatura === 'RUC' && numero.startsWith('20');
  const crear = useMutation({
    mutationFn: () => api<Cliente>('/clientes', json({ tipoDocumentoId: tipo!.id, numeroDocumento: numero, nombres, apellidos, razonSocial: razon, telefono, pais })),
    onSuccess: (c) => { onCambio(c); setNuevo(false); },
  });

  if (valor) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-acento/40 bg-acento-suave/40 px-3 py-2 text-sm">
        <div><div className="font-semibold">{valor.nombre}</div><div className="text-xs text-tinta-suave">{valor.documento}{valor.telefono ? ` · ${valor.telefono}` : ''}</div></div>
        <button type="button" className="text-xs text-tinta-suave hover:text-tinta" onClick={() => onCambio(null)}>Cambiar</button>
      </div>
    );
  }
  if (nuevo) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-borde p-3">
        <div className="grid grid-cols-[110px_1fr] gap-2">
          <Campo etiqueta="Documento">
            <Selector value={tipo?.id ?? ''} onChange={(e) => setTipoId(Number(e.target.value))}>
              {tipos.data?.map((t) => <option key={t.id} value={t.id}>{t.abreviatura}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Número"><Entrada value={numero} onChange={(e) => setNumero(e.target.value.trim())} autoFocus /></Campo>
        </div>
        {esEmpresa ? (
          <Campo etiqueta="Razón social"><Entrada value={razon} onChange={(e) => setRazon(e.target.value)} /></Campo>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Campo etiqueta="Nombres"><Entrada value={nombres} onChange={(e) => setNombres(e.target.value)} /></Campo>
            <Campo etiqueta="Apellidos"><Entrada value={apellidos} onChange={(e) => setApellidos(e.target.value)} /></Campo>
          </div>
        )}
        <div className="grid grid-cols-[1fr_80px] gap-2">
          <Campo etiqueta="Teléfono (opcional)"><Entrada value={telefono} onChange={(e) => setTelefono(e.target.value)} /></Campo>
          <Campo etiqueta="País"><Entrada value={pais} maxLength={2} onChange={(e) => setPais(e.target.value.toUpperCase())} /></Campo>
        </div>
        {crear.error && <Aviso>{crear.error.message}</Aviso>}
        <div className="flex gap-2">
          <Button type="button" variante="primario" disabled={!numero || crear.isPending} onClick={() => crear.mutate()}>Guardar huésped</Button>
          <Button type="button" variante="fantasma" onClick={() => setNuevo(false)}>Cancelar</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="relative flex flex-col gap-2">
      <Entrada placeholder="DNI, pasaporte o nombre del huésped" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar huésped" />
      {diferida.trim().length >= 2 && (
        <div className="flex flex-col overflow-hidden rounded-lg border border-borde bg-white">
          {resultados.data?.map((c) => (
            <button key={c.id} type="button" className="flex justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-fondo" onClick={() => onCambio(c)}>
              <span className="font-medium">{c.nombre}</span><span className="text-xs text-tinta-suave">{c.documento}</span>
            </button>
          ))}
          {resultados.data?.length === 0 && <span className="px-3 py-2 text-sm text-tinta-suave">Sin resultados.</span>}
        </div>
      )}
      <button type="button" className="self-start text-sm font-medium text-acento hover:underline" onClick={() => { setNuevo(true); if (/^\d{8}$/.test(q.trim())) setNumero(q.trim()); }}>+ Registrar huésped nuevo</button>
    </div>
  );
}

export interface InicialReserva {
  habitacionId?: number;
  llegada?: string;
  noches?: number;
}

/**
 * Formulario de reserva (S-06 §6): huésped, fechas, habitación libre, personas y precio de la tarifa vigente.
 * Se usa desde el calendario y desde el plano del hotel.
 */
export function PanelNuevaReserva({ inicial, onListo }: { inicial?: InicialReserva; onListo: (r: Reserva) => void }) {
  const qc = useQueryClient();
  const canales = useQuery({ queryKey: ['reservas', 'canales'], queryFn: () => api<Canal[]>('/hospedaje/canales') });
  const turnos = useQuery({ queryKey: ['reservas', 'turnos'], queryFn: () => api<Turno[]>('/hospedaje/turnos') });
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [llegada, setLlegada] = useState(inicial?.llegada ?? hoyLima());
  const [cantidad, setCantidad] = useState(inicial?.noches ?? 1);
  const [turnoId, setTurnoId] = useState<number | null>(null);
  const [hora, setHora] = useState('14:00');
  const [canalId, setCanalId] = useState<number | null>(null);
  const [habitacionId, setHabitacionId] = useState<number | undefined>(inicial?.habitacionId);
  const [adultos, setAdultos] = useState(1);
  const [ninos, setNinos] = useState(0);
  const [adelanto, setAdelanto] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [codigoExterno, setCodigoExterno] = useState('');
  const [observaciones, setObservaciones] = useState('');

  const turno = turnos.data?.find((t) => t.id === turnoId) ?? turnos.data?.find((t) => t.duracion_horas === 24);
  const canalesActivos = canales.data?.filter((c) => c.activo !== false) ?? [];
  const canal = canalesActivos.find((c) => c.id === canalId) ?? canalesActivos[0];
  const esOta = canal?.esOta ?? canal?.es_ota ?? false;
  const porHoras = turno ? turno.duracion_horas !== 24 : false;

  const disp = useQuery({
    queryKey: ['reservas', 'disponibilidad', llegada, cantidad, turno?.id, porHoras ? hora : ''],
    queryFn: () => api<Disponibilidad>(`/reservas/disponibilidad?${new URLSearchParams({ llegada, cantidad: String(cantidad), turnoId: String(turno!.id), ...(porHoras && { hora }) })}`),
    enabled: !!turno && cantidad >= 1,
  });
  const hab = disp.data?.habitaciones.find((h) => h.id === habitacionId);
  const libres = useMemo(() => disp.data?.habitaciones.filter((h) => h.libre) ?? [], [disp.data]);

  const precio = useQuery({
    queryKey: ['reservas', 'precio', hab?.tipo.id, canal?.id, turno?.id, llegada],
    queryFn: () => api<{ precio: string }>(`/hospedaje/tarifas/vigente?${new URLSearchParams({ tipoId: String(hab!.tipo.id), canalId: String(canal!.id), turnoId: String(turno!.id), fecha: llegada })}`),
    enabled: !!hab && !!canal && !!turno,
    retry: false,
  });
  const total = precio.data ? Number(precio.data.precio) * cantidad : null;

  const crear = useMutation({
    mutationFn: () =>
      api<Reserva>('/reservas', json({
        clienteId: cliente!.id, canalId: canal!.id, turnoId: turno!.id, habitacionId, llegada, cantidad, ...(porHoras && { hora }),
        adultos, ninos, adelanto: adelanto ? Number(adelanto) : undefined, confirmar, codigoExterno: esOta ? codigoExterno : null, observaciones: observaciones || null,
      })),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['reservas'] });
      qc.invalidateQueries({ queryKey: ['plano'] });
      qc.invalidateQueries({ queryKey: ['tablero'] });
      onListo(r);
    },
  });

  const maxAdultos = hab?.tipo.adultos ?? 6;
  const valido = cliente && hab?.libre && canal && turno && adultos >= 1 && adultos <= maxAdultos && total !== null;

  return (
    <form className="flex flex-col gap-4" onSubmit={(e: FormEvent) => { e.preventDefault(); if (valido) crear.mutate(); }}>
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Huésped titular</span>
        <ElegirHuesped valor={cliente} onCambio={setCliente} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Llegada"><Entrada type="date" min={hoyLima()} value={llegada} onChange={(e) => setLlegada(e.target.value)} required /></Campo>
        <Campo etiqueta="Turno">
          <Selector value={turno?.id ?? ''} onChange={(e) => setTurnoId(Number(e.target.value))}>
            {turnos.data?.map((t) => <option key={t.id} value={t.id}>{t.duracion_horas === 24 ? 'Por noche (24 h)' : `${t.duracion_horas} horas`}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta={porHoras ? 'Cantidad de turnos' : 'Noches'}>
          <Entrada type="number" min={1} max={porHoras ? 8 : 60} value={cantidad} onChange={(e) => setCantidad(Math.max(1, Number(e.target.value)))} />
        </Campo>
        {porHoras ? (
          <Campo etiqueta="Hora de llegada"><Entrada type="time" value={hora} onChange={(e) => setHora(e.target.value)} /></Campo>
        ) : (
          <Campo etiqueta="Horario"><span className="flex h-9 items-center text-sm text-tinta-suave">Entra 14:00 · sale 12:00</span></Campo>
        )}
      </div>

      <Campo etiqueta="Habitación" ayuda={disp.data ? `${libres.length} libres en esas fechas` : undefined}>
        <Selector value={habitacionId ?? ''} onChange={(e) => setHabitacionId(Number(e.target.value) || undefined)}>
          <option value="">Elige una habitación libre…</option>
          {disp.data?.habitaciones.map((h) => (
            <option key={h.id} value={h.id} disabled={!h.libre}>{h.numero} · {h.tipo.nombre} ({h.tipo.adultos} pers.){h.libre ? '' : ' — ocupada'}</option>
          ))}
        </Selector>
      </Campo>
      {hab && !hab.libre && <Aviso>{hab.numero}: {hab.motivo}. Elige otra o cambia las fechas.</Aviso>}
      {hab?.aviso && <Aviso tipo="info">{hab.numero}: {hab.aviso}.</Aviso>}

      <div className="grid grid-cols-3 gap-3">
        <Campo etiqueta="Canal">
          <Selector value={canal?.id ?? ''} onChange={(e) => setCanalId(Number(e.target.value))}>
            {canalesActivos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Adultos"><Entrada type="number" min={1} max={maxAdultos} value={adultos} onChange={(e) => setAdultos(Number(e.target.value))} /></Campo>
        <Campo etiqueta="Niños"><Entrada type="number" min={0} max={hab?.tipo.ninos ?? 6} value={ninos} onChange={(e) => setNinos(Number(e.target.value))} /></Campo>
      </div>
      {esOta && <Campo etiqueta="Código de la reserva en el canal"><Entrada value={codigoExterno} onChange={(e) => setCodigoExterno(e.target.value)} placeholder="Ej. BK-4410237" /></Campo>}

      <div className="rounded-lg bg-fondo p-3 text-sm">
        {precio.data && total !== null ? (
          <>
            <div className="flex justify-between gap-3"><span>Tarifa vigente ({canal?.nombre} · {porHoras ? `${turno?.duracion_horas} h` : 'noche'})</span><b className="tabular-nums">{soles(precio.data.precio)}</b></div>
            <div className="flex justify-between"><span>× {cantidad} {porHoras ? 'turnos' : cantidad === 1 ? 'noche' : 'noches'}</span><b className="text-base tabular-nums">{soles(total)}</b></div>
          </>
        ) : precio.isError ? (
          <span className="text-ocupada">No hay tarifa para esta habitación, canal y turno. Configúrala en Hotel y tarifas.</span>
        ) : (
          <span className="text-tinta-suave">Elige la habitación para ver el precio.</span>
        )}
      </div>
      <div className="grid grid-cols-2 items-end gap-3">
        <Campo etiqueta="Adelanto (opcional)"><Entrada type="number" min={0} step="0.01" value={adelanto} onChange={(e) => setAdelanto(e.target.value)} placeholder="0.00" /></Campo>
        <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={confirmar || Number(adelanto) > 0} disabled={Number(adelanto) > 0} onChange={(e) => setConfirmar(e.target.checked)} /> Reserva confirmada</label>
      </div>
      <Campo etiqueta="Observaciones (opcional)"><Entrada value={observaciones} maxLength={500} onChange={(e) => setObservaciones(e.target.value)} placeholder="Llega tarde, cuna, cama extra…" /></Campo>
      {crear.error && <Aviso>{crear.error.message}</Aviso>}
      <Button variante="primario" type="submit" disabled={!valido || crear.isPending} className={clsx('h-10')}>
        {crear.isPending ? 'Registrando…' : total !== null ? `Registrar reserva · ${soles(total)}` : 'Registrar reserva'}
      </Button>
    </form>
  );
}
