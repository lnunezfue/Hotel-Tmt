import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type Estado } from '../lib/api';
import { puede, useSesion } from '../features/auth/sesion';
import { ESTILO_ESTADO } from '../features/hospedaje/estados';
import { fechaCorta, soles } from '../features/hospedaje/formato';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Aviso, Campo, Entrada, PanelLateral, Pestanas, Pildora, Selector } from '../components/ui/form';

interface Piso { id: number; numero: number; nombre: string; activo: boolean; habitaciones: number }
interface Tipo { id: number; nombre: string; descripcion: string | null; capacidadAdultos: number; capacidadNinos: number; activo: boolean; habitaciones: number }
interface Habitacion { id: number; numero: string; descripcion: string | null; activo: boolean; estado: Estado; piso: { id: number; nombre: string; numero: number }; tipo: { id: number; nombre: string } }
interface Canal { id: number; nombre: string; es_ota: boolean }
interface Turno { id: number; nombre: string; duracion_horas: number }
interface PrecioCelda { id: number; precio: string; moneda: string; desde: string; hasta: string | null }
interface Celda { tipoId: number; canalId: number; turnoId: number; vigente: PrecioCelda | null; programada: PrecioCelda | null }
interface Matriz { fecha: string; hoy: string; celdas: Celda[] }

const json = (method: string, cuerpo: unknown) => ({ method, body: JSON.stringify(cuerpo) });

function usePisos() { return useQuery({ queryKey: ['config', 'pisos'], queryFn: () => api<Piso[]>('/hospedaje/config/pisos') }); }
function useTipos() { return useQuery({ queryKey: ['config', 'tipos'], queryFn: () => api<Tipo[]>('/hospedaje/config/tipos-habitacion') }); }

/** Invalida la configuración y el tablero (lo que se cambia aquí se ve allí). */
function useRefrescar() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['config'] });
    qc.invalidateQueries({ queryKey: ['tablero'] });
  };
}

// ── Habitaciones ────────────────────────────────────────────────

function EditorHabitacion({ h, pisos, tipos, onListo }: { h: Habitacion; pisos: Piso[]; tipos: Tipo[]; onListo: (m: string) => void }) {
  const refrescar = useRefrescar();
  const [numero, setNumero] = useState(h.numero);
  const [pisoId, setPisoId] = useState(h.piso.id);
  const [tipoId, setTipoId] = useState(h.tipo.id);
  const [descripcion, setDescripcion] = useState(h.descripcion ?? '');
  const guardar = useMutation({
    mutationFn: (cambios: Record<string, unknown>) => api(`/hospedaje/habitaciones/${h.id}`, json('PATCH', cambios)),
    onSuccess: (_r, c) => { refrescar(); onListo('activo' in c ? `Habitación ${h.numero} ${c.activo ? 'activada' : 'desactivada'}.` : `Habitación ${numero} guardada.`); },
  });
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); guardar.mutate({ numero, pisoId, tipoHabitacionId: tipoId, descripcion: descripcion || null }); }}>
      <Campo etiqueta="Número"><Entrada value={numero} maxLength={10} onChange={(e) => setNumero(e.target.value)} required /></Campo>
      <Campo etiqueta="Piso">
        <Selector value={pisoId} onChange={(e) => setPisoId(Number(e.target.value))}>
          {pisos.filter((p) => p.activo || p.id === h.piso.id).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </Selector>
      </Campo>
      <Campo etiqueta="Tipo">
        <Selector value={tipoId} onChange={(e) => setTipoId(Number(e.target.value))}>
          {tipos.filter((t) => t.activo || t.id === h.tipo.id).map((t) => <option key={t.id} value={t.id}>{t.nombre} · {t.capacidadAdultos} pers.</option>)}
        </Selector>
      </Campo>
      <Campo etiqueta="Descripción (opcional)"><Entrada value={descripcion} maxLength={300} onChange={(e) => setDescripcion(e.target.value)} placeholder="Vista a la calle, baño con tina…" /></Campo>
      {guardar.error && <Aviso>{guardar.error.message}</Aviso>}
      <Button variante="primario" type="submit" disabled={guardar.isPending}>Guardar</Button>
      <div className="border-t border-borde pt-4">
        {h.activo ? (
          <>
            <Button variante="secundario" className="text-ocupada" type="button" disabled={guardar.isPending} onClick={() => guardar.mutate({ activo: false })}>Desactivar habitación</Button>
            <p className="mt-2 text-xs text-tinta-suave">Deja de verse en el tablero y no se puede vender. No se permite si está ocupada.</p>
          </>
        ) : (
          <Button type="button" disabled={guardar.isPending} onClick={() => guardar.mutate({ activo: true })}>Activar habitación</Button>
        )}
      </div>
    </form>
  );
}

function PestanaHabitaciones() {
  const refrescar = useRefrescar();
  const habs = useQuery({ queryKey: ['config', 'habitaciones'], queryFn: () => api<Habitacion[]>('/hospedaje/config/habitaciones') });
  const pisos = usePisos();
  const tipos = useTipos();
  const [editando, setEditando] = useState<Habitacion | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [verInactivas, setVerInactivas] = useState(false);
  const [numero, setNumero] = useState('');
  const [pisoId, setPisoId] = useState<number | ''>('');
  const [tipoId, setTipoId] = useState<number | ''>('');
  const crear = useMutation({
    mutationFn: () => api<{ numero: string }>('/hospedaje/habitaciones', json('POST', { numero, pisoId, tipoHabitacionId: tipoId })),
    onSuccess: (r) => { refrescar(); setAviso(`Habitación ${r.numero} creada como disponible.`); setNumero(''); },
  });
  const pisosActivos = pisos.data?.filter((p) => p.activo) ?? [];
  const tiposActivos = tipos.data?.filter((t) => t.activo) ?? [];
  const grupos = useMemo(() => {
    const m = new Map<number, { nombre: string; habs: Habitacion[] }>();
    for (const h of habs.data ?? []) {
      if (!verInactivas && !h.activo) continue;
      const g = m.get(h.piso.id) ?? { nombre: h.piso.nombre, habs: [] };
      g.habs.push(h);
      m.set(h.piso.id, g);
    }
    return [...m.values()];
  }, [habs.data, verInactivas]);
  const inactivas = habs.data?.filter((h) => !h.activo).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e: FormEvent) => { e.preventDefault(); if (numero && pisoId && tipoId) crear.mutate(); }}>
          <Campo etiqueta="Número" className="w-28"><Entrada value={numero} maxLength={10} onChange={(e) => setNumero(e.target.value)} placeholder="105" /></Campo>
          <Campo etiqueta="Piso" className="w-44">
            <Selector value={pisoId} onChange={(e) => setPisoId(Number(e.target.value))}><option value="">Elige…</option>{pisosActivos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Selector>
          </Campo>
          <Campo etiqueta="Tipo" className="w-52">
            <Selector value={tipoId} onChange={(e) => setTipoId(Number(e.target.value))}><option value="">Elige…</option>{tiposActivos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</Selector>
          </Campo>
          <Button variante="primario" type="submit" disabled={!numero || !pisoId || !tipoId || crear.isPending}>+ Agregar habitación</Button>
          {inactivas > 0 && (
            <label className="ml-auto flex items-center gap-2 text-sm text-tinta-suave"><input type="checkbox" checked={verInactivas} onChange={(e) => setVerInactivas(e.target.checked)} /> Ver {inactivas} inactivas</label>
          )}
        </form>
      </Card>
      {crear.error && <Aviso>{crear.error.message}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {grupos.map((g) => (
        <section key={g.nombre} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold tracking-widest text-tinta-suave uppercase">{g.nombre} · {g.habs.length}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
            {g.habs.map((h) => (
              <button key={h.id} onClick={() => { setAviso(null); setEditando(h); }} className={clsx('flex flex-col gap-1 rounded-xl border bg-white p-3 text-left hover:shadow-sm', h.activo ? 'border-borde' : 'border-dashed border-borde opacity-60')}>
                <span className="flex items-center justify-between"><b className="text-lg tabular-nums">{h.numero}</b>{!h.activo && <Pildora className="bg-fondo text-tinta-suave">inactiva</Pildora>}</span>
                <span className="text-xs text-tinta-suave">{h.tipo.nombre}</span>
                <span className={clsx('flex items-center gap-1.5 text-[11px] font-semibold uppercase', ESTILO_ESTADO[h.estado].texto)}><span className={clsx('h-2 w-2 rounded-full', ESTILO_ESTADO[h.estado].punto)} />{ESTILO_ESTADO[h.estado].etiqueta}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      <PanelLateral titulo={`Habitación ${editando?.numero ?? ''}`} abierto={!!editando} onCerrar={() => setEditando(null)}>
        {editando && pisos.data && tipos.data && <EditorHabitacion key={editando.id} h={editando} pisos={pisos.data} tipos={tipos.data} onListo={(m) => { setAviso(m); setEditando(null); }} />}
      </PanelLateral>
    </div>
  );
}

// ── Pisos ───────────────────────────────────────────────────────

function PestanaPisos() {
  const refrescar = useRefrescar();
  const pisos = usePisos();
  const [numero, setNumero] = useState('');
  const [nombre, setNombre] = useState('');
  const [renombrando, setRenombrando] = useState<{ id: number; nombre: string } | null>(null);
  const crear = useMutation({
    mutationFn: () => api('/hospedaje/pisos', json('POST', { numero: Number(numero), nombre })),
    onSuccess: () => { refrescar(); setNumero(''); setNombre(''); },
  });
  const editar = useMutation({
    mutationFn: ({ id, ...c }: { id: number; nombre?: string; activo?: boolean }) => api(`/hospedaje/pisos/${id}`, json('PATCH', c)),
    onSuccess: () => { refrescar(); setRenombrando(null); },
  });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); crear.mutate(); }}>
          <Campo etiqueta="Número" ayuda="Negativo para sótanos" className="w-28"><Entrada type="number" value={numero} onChange={(e) => { setNumero(e.target.value); if (!nombre || /^Piso -?\d*$/.test(nombre)) setNombre(e.target.value ? `Piso ${e.target.value}` : ''); }} /></Campo>
          <Campo etiqueta="Nombre" className="flex-1"><Entrada value={nombre} maxLength={50} onChange={(e) => setNombre(e.target.value)} placeholder="Piso 4" /></Campo>
          <Button variante="primario" type="submit" disabled={numero === '' || !nombre.trim() || crear.isPending}>+ Agregar piso</Button>
        </form>
      </Card>
      {crear.error && <Aviso>{crear.error.message}</Aviso>}
      {editar.error && <Aviso>{editar.error.message}</Aviso>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-fondo text-left text-xs tracking-wide text-tinta-suave uppercase"><tr><th className="px-4 py-3">N.º</th><th className="px-4 py-3">Nombre</th><th className="px-4 py-3">Habitaciones activas</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3" /></tr></thead>
          <tbody>
            {pisos.data?.map((p) => (
              <tr key={p.id} className="border-t border-borde">
                <td className="px-4 py-2.5 font-semibold tabular-nums">{p.numero}</td>
                <td className="px-4 py-2.5">
                  {renombrando?.id === p.id ? (
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); editar.mutate({ id: p.id, nombre: renombrando.nombre }); }}>
                      <Entrada value={renombrando.nombre} onChange={(e) => setRenombrando({ id: p.id, nombre: e.target.value })} autoFocus className="h-8" />
                      <Button type="submit" className="h-8">Guardar</Button>
                    </form>
                  ) : p.nombre}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{p.habitaciones}</td>
                <td className="px-4 py-2.5"><Pildora className={p.activo ? 'bg-desocupada/10 text-desocupada' : 'bg-fondo text-tinta-suave'}>{p.activo ? 'activo' : 'inactivo'}</Pildora></td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <Button variante="fantasma" className="h-8 px-2" onClick={() => setRenombrando({ id: p.id, nombre: p.nombre })}>Renombrar</Button>
                  <Button variante="fantasma" className="h-8 px-2" disabled={p.activo && p.habitaciones > 0} title={p.activo && p.habitaciones > 0 ? 'Tiene habitaciones activas' : undefined} onClick={() => editar.mutate({ id: p.id, activo: !p.activo })}>{p.activo ? 'Desactivar' : 'Activar'}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── Tipos de habitación ─────────────────────────────────────────

function EditorTipo({ t, onListo }: { t: Tipo | null; onListo: () => void }) {
  const refrescar = useRefrescar();
  const [nombre, setNombre] = useState(t?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(t?.descripcion ?? '');
  const [adultos, setAdultos] = useState(t?.capacidadAdultos ?? 2);
  const [ninos, setNinos] = useState(t?.capacidadNinos ?? 0);
  const guardar = useMutation({
    mutationFn: (extra: Record<string, unknown> = {}) => {
      const datos = { nombre, descripcion: descripcion || null, capacidadAdultos: adultos, capacidadNinos: ninos, ...extra };
      return t ? api(`/hospedaje/tipos-habitacion/${t.id}`, json('PATCH', datos)) : api('/hospedaje/tipos-habitacion', json('POST', datos));
    },
    onSuccess: () => { refrescar(); onListo(); },
  });
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); guardar.mutate({}); }}>
      <Campo etiqueta="Nombre"><Entrada value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} placeholder="Suite" required /></Campo>
      <Campo etiqueta="Descripción"><Entrada value={descripcion} maxLength={300} onChange={(e) => setDescripcion(e.target.value)} /></Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Adultos"><Entrada type="number" min={1} max={20} value={adultos} onChange={(e) => setAdultos(Number(e.target.value))} /></Campo>
        <Campo etiqueta="Niños"><Entrada type="number" min={0} max={20} value={ninos} onChange={(e) => setNinos(Number(e.target.value))} /></Campo>
      </div>
      {guardar.error && <Aviso>{guardar.error.message}</Aviso>}
      <Button variante="primario" type="submit" disabled={nombre.trim().length < 2 || guardar.isPending}>{t ? 'Guardar' : 'Crear tipo'}</Button>
      {t && (
        <Button type="button" disabled={guardar.isPending || (t.activo && t.habitaciones > 0)} onClick={() => guardar.mutate({ activo: !t.activo })}>
          {t.activo ? 'Desactivar tipo' : 'Activar tipo'}
        </Button>
      )}
      {t?.activo && t.habitaciones > 0 && <p className="text-xs text-tinta-suave">Para desactivarlo, cambia primero de tipo a sus {t.habitaciones} habitaciones.</p>}
    </form>
  );
}

function PestanaTipos() {
  const tipos = useTipos();
  const [editando, setEditando] = useState<Tipo | 'nuevo' | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <div><Button variante="primario" onClick={() => setEditando('nuevo')}>+ Nuevo tipo</Button></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {tipos.data?.map((t) => (
          <button key={t.id} onClick={() => setEditando(t)} className={clsx('flex flex-col gap-1 rounded-xl border bg-white p-4 text-left hover:shadow-sm', t.activo ? 'border-borde' : 'border-dashed border-borde opacity-60')}>
            <span className="flex items-center justify-between"><b>{t.nombre}</b>{!t.activo && <Pildora className="bg-fondo text-tinta-suave">inactivo</Pildora>}</span>
            <span className="text-sm text-tinta-suave">{t.capacidadAdultos} adultos{t.capacidadNinos ? ` + ${t.capacidadNinos} niños` : ''}</span>
            <span className="text-xs text-tinta-suave">{t.habitaciones} habitaciones en esta sucursal</span>
            {t.descripcion && <span className="text-xs">{t.descripcion}</span>}
          </button>
        ))}
      </div>
      <p className="text-xs text-tinta-suave">Los tipos son de la empresa: se comparten entre sucursales. Las tarifas sí son por sucursal.</p>
      <PanelLateral titulo={editando === 'nuevo' ? 'Nuevo tipo de habitación' : `Tipo ${editando?.nombre ?? ''}`} abierto={editando !== null} onCerrar={() => setEditando(null)}>
        {editando !== null && <EditorTipo key={editando === 'nuevo' ? 'n' : editando.id} t={editando === 'nuevo' ? null : editando} onListo={() => setEditando(null)} />}
      </PanelLateral>
    </div>
  );
}

// ── Tarifas ─────────────────────────────────────────────────────

function EditorTarifa({ tipo, canal, turno, celda, hoy, puedeEditar, onListo }: { tipo: Tipo; canal: Canal; turno: Turno; celda?: Celda; hoy: string; puedeEditar: boolean; onListo: (m: string) => void }) {
  const qc = useQueryClient();
  const clave = { tipoId: tipo.id, canalId: canal.id, turnoId: turno.id };
  const historial = useQuery({
    queryKey: ['config', 'tarifa-historial', clave],
    queryFn: () => api<Array<{ id: number; precio: string; desde: string; hasta: string | null }>>(`/hospedaje/tarifas/historial?${new URLSearchParams(Object.entries(clave).map(([k, v]) => [k, String(v)]))}`),
  });
  const [precio, setPrecio] = useState(celda?.vigente?.precio ?? '');
  const [desde, setDesde] = useState(celda?.programada ? '' : hoy);
  const crear = useMutation({
    mutationFn: () => api<{ precio: string; desde: string }>('/hospedaje/tarifas', json('POST', { ...clave, precio: Number(precio), desde })),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['config'] }); onListo(`${tipo.nombre} · ${turno.nombre} · ${canal.nombre}: ${soles(r.precio)} desde el ${fechaCorta(r.desde)}.`); },
  });
  const n = Number(precio);
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg bg-fondo p-3 text-sm">
        <div className="text-xs text-tinta-suave">{canal.nombre} · {turno.nombre}</div>
        <div className="text-2xl font-bold tabular-nums">{celda?.vigente ? soles(celda.vigente.precio) : 'Sin precio'}</div>
        {celda?.vigente && <div className="text-xs text-tinta-suave">Rige desde el {fechaCorta(celda.vigente.desde)}{celda.vigente.hasta ? ` hasta el ${fechaCorta(celda.vigente.hasta)}` : ''}</div>}
        {celda?.programada && <div className="mt-1 text-xs font-medium text-acento">Cambio programado: {soles(celda.programada.precio)} desde el {fechaCorta(celda.programada.desde)}</div>}
      </div>
      {puedeEditar ? (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); crear.mutate(); }}>
          <h3 className="text-sm font-semibold">Programar un precio nuevo</h3>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Precio (S/, con IGV)"><Entrada type="number" step="0.01" min="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} required /></Campo>
            <Campo etiqueta="Rige desde"><Entrada type="date" min={hoy} value={desde} onChange={(e) => setDesde(e.target.value)} required /></Campo>
          </div>
          <p className="text-xs text-tinta-suave">El precio actual sigue vigente hasta el día anterior. Las reservas ya registradas conservan su precio.</p>
          {crear.error && <Aviso>{crear.error.message}</Aviso>}
          <Button variante="primario" type="submit" disabled={!(n > 0) || !desde || crear.isPending}>Guardar tarifa</Button>
        </form>
      ) : (
        <Aviso tipo="info">Tu rol puede ver las tarifas pero no cambiarlas (permiso «tarifa.editar»).</Aviso>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs tracking-widest text-tinta-suave uppercase">Historial</h3>
        <ol className="flex flex-col gap-1.5 text-sm">
          {historial.data?.map((h) => (
            <li key={h.id} className="flex justify-between border-l-2 border-borde pl-3">
              <span>{fechaCorta(h.desde)} → {h.hasta ? fechaCorta(h.hasta) : 'sin fin'}</span>
              <b className="tabular-nums">{soles(h.precio)}</b>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function PestanaTarifas() {
  const { data: sesion } = useSesion();
  const tipos = useTipos();
  const canales = useQuery({ queryKey: ['config', 'canales'], queryFn: () => api<Canal[]>('/hospedaje/canales') });
  const turnos = useQuery({ queryKey: ['config', 'turnos'], queryFn: () => api<Turno[]>('/hospedaje/turnos') });
  const [canalId, setCanalId] = useState<number | null>(null);
  const [fecha, setFecha] = useState('');
  const matriz = useQuery({ queryKey: ['config', 'tarifas', fecha], queryFn: () => api<Matriz>(`/hospedaje/tarifas${fecha ? `?fecha=${fecha}` : ''}`) });
  const [sel, setSel] = useState<{ tipo: Tipo; turno: Turno } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const canal = canales.data?.find((c) => c.id === canalId) ?? canales.data?.[0];
  const celda = (tipoId: number, turnoId: number) => matriz.data?.celdas.find((c) => c.tipoId === tipoId && c.canalId === canal?.id && c.turnoId === turnoId);
  const tiposActivos = tipos.data?.filter((t) => t.activo) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1" role="group" aria-label="Canal de venta">
          {canales.data?.map((c) => <Button key={c.id} variante={c.id === canal?.id ? 'primario' : 'secundario'} onClick={() => setCanalId(c.id)}>{c.nombre}{c.es_ota ? ' · OTA' : ''}</Button>)}
        </div>
        <Campo etiqueta="Ver precios al" className="ml-auto w-44"><Entrada type="date" value={fecha || matriz.data?.hoy || ''} onChange={(e) => setFecha(e.target.value)} /></Campo>
      </div>
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {matriz.error && <Aviso>{matriz.error.message}</Aviso>}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-fondo text-left text-xs tracking-wide text-tinta-suave uppercase">
            <tr><th className="px-4 py-3">Tipo</th>{turnos.data?.map((t) => <th key={t.id} className="px-4 py-3 text-right">{t.duracion_horas} h</th>)}</tr>
          </thead>
          <tbody>
            {tiposActivos.map((t) => (
              <tr key={t.id} className="border-t border-borde">
                <td className="px-4 py-2"><div className="font-semibold">{t.nombre}</div><div className="text-xs text-tinta-suave">{t.capacidadAdultos} pers.</div></td>
                {turnos.data?.map((tu) => {
                  const c = celda(t.id, tu.id);
                  return (
                    <td key={tu.id} className="px-2 py-1.5 text-right">
                      <button
                        onClick={() => { setAviso(null); setSel({ tipo: t, turno: tu }); }}
                        className={clsx('w-full rounded-lg px-2 py-1.5 text-right hover:bg-fondo', !c?.vigente && 'border border-dashed border-borde text-tinta-suave')}
                        aria-label={`Tarifa ${t.nombre} ${tu.nombre}`}
                      >
                        <span className="block font-semibold tabular-nums">{c?.vigente ? soles(c.vigente.precio) : '—'}</span>
                        {c?.programada && <span className="block text-[11px] text-acento">→ {soles(c.programada.precio)} el {fechaCorta(c.programada.desde)}</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-tinta-suave">Precios con IGV de la sucursal activa. Haz clic en una celda para ver su historial o programar un cambio.</p>
      <PanelLateral titulo={sel ? `Tarifa ${sel.tipo.nombre}` : ''} abierto={!!sel && !!canal} onCerrar={() => setSel(null)}>
        {sel && canal && matriz.data && (
          <EditorTarifa
            key={`${sel.tipo.id}-${canal.id}-${sel.turno.id}`}
            tipo={sel.tipo}
            canal={canal}
            turno={sel.turno}
            celda={celda(sel.tipo.id, sel.turno.id)}
            hoy={matriz.data.hoy}
            puedeEditar={puede(sesion, 'tarifa.editar')}
            onListo={(m) => { setAviso(m); setSel(null); }}
          />
        )}
      </PanelLateral>
    </div>
  );
}

type Pestana = 'habitaciones' | 'pisos' | 'tipos' | 'tarifas';

export function ConfiguracionHotelPage() {
  const [pestana, setPestana] = useState<Pestana>('habitaciones');
  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="text-xs text-tinta-suave">Configuración / Hotel y tarifas</div>
        <h1 className="text-2xl font-bold">Hotel y tarifas</h1>
        <p className="text-sm text-tinta-suave">Configuración de la sucursal activa. Cada cambio queda en la bitácora de auditoría.</p>
      </header>
      <Pestanas<Pestana>
        opciones={[{ id: 'habitaciones', texto: 'Habitaciones' }, { id: 'pisos', texto: 'Pisos' }, { id: 'tipos', texto: 'Tipos' }, { id: 'tarifas', texto: 'Tarifas' }]}
        valor={pestana}
        onCambio={setPestana}
      />
      {pestana === 'habitaciones' && <PestanaHabitaciones />}
      {pestana === 'pisos' && <PestanaPisos />}
      {pestana === 'tipos' && <PestanaTipos />}
      {pestana === 'tarifas' && <PestanaTarifas />}
    </div>
  );
}
