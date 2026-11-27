import { useCallback, useEffect, useMemo, useState, type PointerEvent as PE } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import clsx from 'clsx';
import { api, type Amenidad, type Disponibilidad, type ElementoPlano, type Estado, type HabitacionPlano, type PisoPlano, type TipoElementoPlano } from '../lib/api';
import { puede, useSesion } from '../features/auth/sesion';
import { ESTILO_ESTADO, ESTADOS, tiempoRestante } from '../features/hospedaje/estados';
import { DibujoElemento, DibujoHabitacion, ELEMENTOS, VENTANA_ESTADO } from '../features/hospedaje/dibujos-plano';
import { IconoAmenidad, ICONOS_DISPONIBLES } from '../features/hospedaje/iconos-amenidad';
import { buscarHueco, cabe, distribucionInicial, LIMITES, ladoPuerta, siguienteNumero, type Rect } from '../features/hospedaje/plano';
import { hoyLima } from '../features/reservas/fechas';
import { PanelNuevaReserva, type InicialReserva } from '../features/reservas/PanelNuevaReserva';
import { CajonCheckinDirecto, CajonEstancia } from '../features/estancias/Cajones';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Aviso, Campo, Entrada, PanelLateral, Selector } from '../components/ui/form';

type Modo = 'ver' | 'reservar' | 'editar';
interface Tipo { id: number; nombre: string; capacidadAdultos: number; activo: boolean }

const json = (method: string, cuerpo: unknown) => ({ method, body: JSON.stringify(cuerpo) });

/** Ancho disponible del lienzo, para calcular el tamaño de celda (ref por callback: el lienzo aparece después de cargar). */
function useAncho(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [ancho, setAncho] = useState(800);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAncho(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, ancho];
}

// ── Fachada del edificio ────────────────────────────────────────

function Edificio({ pisos, selId, onElegir, onAgregar, puedeAgregar, nuevoId }: { pisos: PisoPlano[]; selId: number | null; onElegir: (id: number) => void; onAgregar: () => void; puedeAgregar: boolean; nuevoId: number | null }) {
  const ordenados = [...pisos].sort((a, b) => b.numero - a.numero);
  return (
    <div className="flex flex-col items-stretch">
      {puedeAgregar && (
        <button
          onClick={onAgregar}
          className="mx-3 mb-1 flex h-11 items-center justify-center gap-2 rounded-t-xl border-2 border-dashed border-acento/60 bg-acento-suave/40 text-sm font-semibold text-acento transition hover:bg-acento-suave"
        >
          <span className="text-lg leading-none">+</span> Agregar piso
        </button>
      )}
      {/* Techo */}
      <svg viewBox="0 0 200 26" className="-mb-px w-full" aria-hidden>
        <path d="M6 26 L18 6 H182 L194 26 Z" fill="#2b3a55" />
        <rect x="150" y="0" width="14" height="12" fill="#2b3a55" />
      </svg>
      <div className="flex flex-col border-x-4 border-[#2b3a55] bg-[#efe6d8]">
        {ordenados.map((p) => {
          const sel = p.id === selId;
          const ventanas = [...p.habitaciones].sort((a, b) => a.numero.localeCompare(b.numero));
          return (
            <button
              key={p.id}
              onClick={() => onElegir(p.id)}
              className={clsx(
                'group relative flex flex-col gap-1 border-b-4 border-[#c9b89c] px-2.5 pt-1.5 pb-2 text-left transition',
                sel ? 'bg-white shadow-[inset_0_0_0_3px_var(--color-acento)]' : 'hover:bg-white/70',
                p.id === nuevoId && 'animate-[caer_.6s_ease-out]',
              )}
              aria-pressed={sel}
              aria-label={`${p.nombre}, ${p.habitaciones.length} habitaciones`}
            >
              <span className={clsx('text-[11px] font-bold tracking-wider uppercase', sel ? 'text-acento' : 'text-tinta-suave')}>{p.nombre}</span>
              <span className="flex flex-wrap gap-1">
                {ventanas.length === 0 && <span className="text-[11px] text-tinta-suave">Sin habitaciones</span>}
                {ventanas.map((h) => (
                  <span key={h.id} title={`${h.numero} · ${ESTILO_ESTADO[h.estado].etiqueta}`} className="h-4 w-3.5 rounded-[2px] border border-[#2b3a55]/60" style={{ background: VENTANA_ESTADO[h.estado] }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      {/* Planta baja: puerta y vereda */}
      <svg viewBox="0 0 200 30" className="w-full" aria-hidden>
        <rect x="0" y="0" width="200" height="22" fill="#2b3a55" />
        <rect x="84" y="2" width="32" height="20" rx="2" fill="#8fc6e8" />
        <path d="M100 2v20" stroke="#2b3a55" strokeWidth="2" />
        <rect x="0" y="22" width="200" height="8" fill="#c9cfd8" />
      </svg>
    </div>
  );
}

// ── Piezas del lienzo ───────────────────────────────────────────

interface Borrador {
  pisoId: number;
  columnas: number;
  filas: number;
  habitaciones: Record<number, Rect>;
  elementos: Array<ElementoPlano & { clave: string }>;
}

const borradorDe = (p: PisoPlano): Borrador => ({
  pisoId: p.id,
  columnas: p.columnas,
  filas: p.filas,
  habitaciones: Object.fromEntries(p.habitaciones.map((h) => [h.id, { x: h.x, y: h.y, ancho: h.ancho, alto: h.alto }])),
  elementos: p.elementos.map((e, i) => ({ ...e, clave: `e${e.id ?? i}` })),
});
const firma = (b: Borrador | null) => (b ? JSON.stringify([b.columnas, b.filas, b.habitaciones, b.elementos.map(({ clave: _c, id: _i, ...r }) => r)]) : '');

function EtiquetasHabitacion({ h, amenidades, celda, modo, disp }: { h: HabitacionPlano; amenidades: Amenidad[]; celda: number; modo: Modo; disp?: Disponibilidad['habitaciones'][number] }) {
  const iconos = h.amenidades.map((c) => amenidades.find((a) => a.codigo === c)).filter((a): a is Amenidad => !!a);
  const max = Math.max(1, Math.floor((h.ancho * celda - 16) / 18));
  const grande = celda >= 52;
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-1.5">
      <div className="flex items-start justify-between gap-1">
        <span className={clsx('rounded-md bg-white/90 px-1.5 leading-tight font-bold tabular-nums shadow-sm', grande ? 'text-base' : 'text-xs')}>{h.numero}</span>
        {modo !== 'editar' && <span className={clsx('mt-1 h-2.5 w-2.5 rounded-full ring-2 ring-white', ESTILO_ESTADO[h.estado].punto)} />}
      </div>
      <div className="flex flex-col items-start gap-0.5">
        {modo === 'ver' && h.estancia && grande && <span className="max-w-full truncate rounded bg-white/85 px-1 text-[10px] font-medium">{h.estancia.huesped}</span>}
        {modo === 'reservar' && disp && (
          <span className={clsx('rounded px-1 text-[10px] font-bold', disp.libre ? 'bg-desocupada text-white' : 'bg-tinta/70 text-white')}>{disp.libre ? 'LIBRE' : 'NO DISPONIBLE'}</span>
        )}
        <span className="flex gap-0.5 rounded bg-white/85 px-0.5 text-tinta">
          {iconos.slice(0, max).map((a) => <IconoAmenidad key={a.codigo} icono={a.icono} className="h-3.5 w-3.5" titulo={a.nombre} />)}
          {iconos.length > max && <span className="text-[10px] font-semibold">+{iconos.length - max}</span>}
        </span>
      </div>
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────

export function PlanoPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: sesion } = useSesion();
  const puedeEditar = puede(sesion, 'habitacion.gestionar');
  const puedeReservar = puede(sesion, 'reserva.crear');
  const plano = useQuery({ queryKey: ['plano'], queryFn: () => api<PisoPlano[]>('/hospedaje/plano'), refetchInterval: 30_000 });
  const amenidades = useQuery({ queryKey: ['amenidades'], queryFn: () => api<Amenidad[]>('/hospedaje/amenidades') });
  const tipos = useQuery({ queryKey: ['config', 'tipos'], queryFn: () => api<Tipo[]>('/hospedaje/config/tipos-habitacion'), enabled: puedeEditar });
  const turnos = useQuery({ queryKey: ['reservas', 'turnos'], queryFn: () => api<Array<{ id: number; duracion_horas: number }>>('/hospedaje/turnos') });

  const modo = (params.get('modo') as Modo) || 'ver';
  const setModo = (m: Modo) => setParams((p) => { p.set('modo', m); return p; }, { replace: true });
  const [pisoId, setPisoId] = useState<number | null>(null);
  const [sel, setSel] = useState<string | null>(null); // 'h12' | 'e3'
  const [nuevoPiso, setNuevoPiso] = useState(false);
  const [recienCreado, setRecienCreado] = useState<number | null>(null);
  const [reservando, setReservando] = useState<InicialReserva | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [cajon, setCajon] = useState<'estancia' | 'checkin' | null>(null);

  const pisos = plano.data ?? [];
  const piso = pisos.find((p) => p.id === pisoId) ?? pisos[0] ?? null;
  const amen = amenidades.data ?? [];

  // Reserva: fechas y filtros
  const [llegada, setLlegada] = useState(hoyLima());
  const [noches, setNoches] = useState(1);
  const [personas, setPersonas] = useState(1);
  const [filtros, setFiltros] = useState<string[]>([]);
  const turno24 = turnos.data?.find((t) => t.duracion_horas === 24);
  const disp = useQuery({
    queryKey: ['reservas', 'disponibilidad', llegada, noches, turno24?.id, ''],
    queryFn: () => api<Disponibilidad>(`/reservas/disponibilidad?${new URLSearchParams({ llegada, cantidad: String(noches), turnoId: String(turno24!.id) })}`),
    enabled: modo === 'reservar' && !!turno24,
  });

  // Edición: borrador del piso
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const original = useMemo(() => (piso ? borradorDe(piso) : null), [piso]);
  useEffect(() => {
    if (modo !== 'editar' || !piso) return setBorrador(null);
    setBorrador((b) => (b && b.pisoId === piso.id ? b : borradorDe(piso)));
  }, [modo, piso]);
  const sucio = modo === 'editar' && firma(borrador) !== firma(original);

  const guardar = useMutation({
    mutationFn: (b: Borrador) =>
      api(`/hospedaje/plano/pisos/${b.pisoId}`, json('PUT', {
        columnas: b.columnas,
        filas: b.filas,
        habitaciones: Object.entries(b.habitaciones).map(([id, r]) => ({ id: Number(id), ...r })),
        elementos: b.elementos.map(({ tipo, etiqueta, x, y, ancho, alto }) => ({ tipo, etiqueta, x, y, ancho, alto })),
      })),
    onSuccess: async (_r, b) => {
      await qc.invalidateQueries({ queryKey: ['plano'] });
      setBorrador(null);
      setAviso({ tipo: 'ok', texto: `Plano del ${pisos.find((p) => p.id === b.pisoId)?.nombre ?? 'piso'} guardado.` });
    },
    onError: (e) => setAviso({ tipo: 'error', texto: e.message }),
  });

  // Lienzo
  const [lienzoRef, anchoLienzo] = useAncho();
  const columnas = borrador?.columnas ?? piso?.columnas ?? 12;
  const filas = borrador?.filas ?? piso?.filas ?? 6;
  const celda = Math.max(30, Math.min(84, Math.floor((anchoLienzo - 12) / columnas)));

  const rectDe = useCallback(
    (clave: string): Rect | null => {
      if (!piso) return null;
      if (clave.startsWith('h')) {
        const id = Number(clave.slice(1));
        if (borrador) return borrador.habitaciones[id] ?? null;
        const h = piso.habitaciones.find((x) => x.id === id);
        return h ? { x: h.x, y: h.y, ancho: h.ancho, alto: h.alto } : null;
      }
      const e = (borrador?.elementos ?? piso.elementos.map((x, i) => ({ ...x, clave: `e${x.id ?? i}` }))).find((x) => x.clave === clave);
      return e ? { x: e.x, y: e.y, ancho: e.ancho, alto: e.alto } : null;
    },
    [borrador, piso],
  );
  const todas = useCallback(
    (excepto?: string): Rect[] => {
      if (!borrador) return [];
      return [
        ...Object.entries(borrador.habitaciones).filter(([id]) => `h${id}` !== excepto).map(([, r]) => r),
        ...borrador.elementos.filter((e) => e.clave !== excepto),
      ];
    },
    [borrador],
  );

  const [arrastre, setArrastre] = useState<{ clave: string; modo: 'mover' | 'tamano'; px: number; py: number; original: Rect; actual: Rect; movio: boolean } | null>(null);
  const valido = arrastre ? cabe(arrastre.actual, columnas, filas, todas(arrastre.clave)) && arrastre.actual.ancho <= (arrastre.clave.startsWith('h') ? LIMITES.lado : 30) : true;

  function ponerRect(clave: string, r: Rect) {
    setBorrador((b) => {
      if (!b) return b;
      if (clave.startsWith('h')) return { ...b, habitaciones: { ...b.habitaciones, [Number(clave.slice(1))]: r } };
      return { ...b, elementos: b.elementos.map((e) => (e.clave === clave ? { ...e, ...r } : e)) };
    });
  }

  function alPresionar(e: PE, clave: string, m: 'mover' | 'tamano') {
    if (modo !== 'editar') return;
    e.stopPropagation();
    const r = rectDe(clave);
    if (!r) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    setArrastre({ clave, modo: m, px: e.clientX, py: e.clientY, original: r, actual: r, movio: false });
  }
  function alMover(e: PE) {
    if (!arrastre) return;
    const dx = Math.round((e.clientX - arrastre.px) / celda);
    const dy = Math.round((e.clientY - arrastre.py) / celda);
    const o = arrastre.original;
    const actual = arrastre.modo === 'mover' ? { ...o, x: o.x + dx, y: o.y + dy } : { ...o, ancho: Math.max(1, o.ancho + dx), alto: Math.max(1, o.alto + dy) };
    if (actual.x !== arrastre.actual.x || actual.y !== arrastre.actual.y || actual.ancho !== arrastre.actual.ancho || actual.alto !== arrastre.actual.alto) {
      setArrastre({ ...arrastre, actual, movio: true });
    }
  }
  function alSoltar() {
    if (!arrastre) return;
    if (!arrastre.movio) setSel(arrastre.clave);
    else if (valido) {
      ponerRect(arrastre.clave, arrastre.actual);
      setSel(arrastre.clave);
    }
    setArrastre(null);
  }

  // Teclado: flechas mueven la pieza elegida (Mayús: cambia el tamaño); Supr quita un elemento
  useEffect(() => {
    if (modo !== 'editar' || !sel) return;
    const tecla = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement).closest('input, select, textarea')) return;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
      if (d) {
        ev.preventDefault();
        const r = rectDe(sel);
        if (!r) return;
        const n = ev.shiftKey ? { ...r, ancho: Math.max(1, r.ancho + d[0]), alto: Math.max(1, r.alto + d[1]) } : { ...r, x: r.x + d[0], y: r.y + d[1] };
        if (cabe(n, columnas, filas, todas(sel))) ponerRect(sel, n);
      }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel.startsWith('e')) {
        setBorrador((b) => (b ? { ...b, elementos: b.elementos.filter((x) => x.clave !== sel) } : b));
        setSel(null);
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [modo, sel, rectDe, columnas, filas, todas]);

  function agregarElemento(tipo: TipoElementoPlano) {
    if (!borrador) return;
    const hueco = buscarHueco(columnas, filas, todas(), ELEMENTOS[tipo].tamano) ?? buscarHueco(columnas, filas, todas(), { ancho: 1, alto: 1 });
    if (!hueco) return setAviso({ tipo: 'error', texto: 'No hay espacio libre: agranda el piso o mueve algo.' });
    const clave = `n${Date.now()}`;
    setBorrador({ ...borrador, elementos: [...borrador.elementos, { clave, tipo, etiqueta: null, ...hueco }] });
    setSel(clave);
  }

  function redimensionarPiso(dc: number, df: number) {
    if (!borrador) return;
    const c = borrador.columnas + dc;
    const f = borrador.filas + df;
    if (c < LIMITES.columnas[0] || c > LIMITES.columnas[1] || f < LIMITES.filas[0] || f > LIMITES.filas[1]) return;
    if (!todas().every((r) => r.x + r.ancho <= c && r.y + r.alto <= f)) return setAviso({ tipo: 'error', texto: 'Hay piezas en el borde: muévelas antes de achicar el piso.' });
    setBorrador({ ...borrador, columnas: c, filas: f });
  }

  // Habitación nueva desde la paleta: se guarda el borrador primero para que el servidor valide sobre lo mismo que ves
  const [tipoNuevo, setTipoNuevo] = useState<number | ''>('');
  const crearHabitacion = useMutation({
    mutationFn: async () => {
      if (!borrador || !piso) throw new Error('Elige un piso');
      const tipo = tipos.data?.find((t) => t.id === tipoNuevo) ?? tipos.data?.find((t) => t.activo);
      if (!tipo) throw new Error('Crea primero un tipo de habitación');
      const hueco = buscarHueco(columnas, filas, todas(), { ancho: 3, alto: 2 }) ?? buscarHueco(columnas, filas, todas(), { ancho: 2, alto: 2 });
      if (!hueco) throw new Error('No hay espacio libre para una habitación: agranda el piso.');
      if (sucio) await guardar.mutateAsync(borrador);
      const numero = siguienteNumero(piso.numero, pisos.flatMap((p) => p.habitaciones.map((h) => h.numero)));
      const amenTipo = piso.habitaciones.find((h) => h.tipo.id === tipo.id)?.amenidades;
      return api<{ id: number; numero: string }>('/hospedaje/habitaciones', json('POST', { numero, pisoId: piso.id, tipoHabitacionId: tipo.id, plano: hueco, amenidades: amenTipo }));
    },
    onSuccess: async (h) => {
      setBorrador(null);
      await qc.invalidateQueries({ queryKey: ['plano'] });
      setSel(`h${h.id}`);
      setAviso({ tipo: 'ok', texto: `Habitación ${h.numero} agregada: arrástrala a su lugar y guarda.` });
    },
    onError: (e) => setAviso({ tipo: 'error', texto: e.message }),
  });

  if (plano.isLoading) return <p className="text-tinta-suave">Cargando el plano…</p>;
  if (plano.error) return <Aviso>{plano.error.message}</Aviso>;

  const habSel = sel?.startsWith('h') ? piso?.habitaciones.find((h) => `h${h.id}` === sel) ?? null : null;
  const elemSel = sel && !sel.startsWith('h') ? borrador?.elementos.find((e) => e.clave === sel) ?? null : null;
  const pasillos = (borrador?.elementos ?? piso?.elementos ?? []).filter((e) => e.tipo === 'PASILLO');
  const dispDe = (id: number) => disp.data?.habitaciones.find((h) => h.id === id);
  const cumpleFiltro = (h: HabitacionPlano) => filtros.every((f) => h.amenidades.includes(f)) && h.tipo.adultos + h.tipo.ninos >= personas;
  const libresVisibles = piso ? piso.habitaciones.filter((h) => dispDe(h.id)?.libre && cumpleFiltro(h)).length : 0;

  return (
    <div className="flex flex-col gap-5">
      <style>{`@keyframes caer { 0% { transform: translateY(-40px); opacity: 0 } 70% { transform: translateY(4px); opacity: 1 } 100% { transform: none } }`}</style>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs text-tinta-suave">Hotel / Plano</div>
          <h1 className="text-2xl font-bold">Plano del hotel</h1>
        </div>
        <div className="flex rounded-xl border border-borde bg-white p-1" role="tablist" aria-label="Modo">
          {([['ver', 'Ver estado'], ['reservar', 'Reservar'], ...(puedeEditar ? [['editar', 'Diseñar plano']] : [])] as Array<[Modo, string]>).map(([m, t]) => (
            <button
              key={m}
              role="tab"
              aria-selected={modo === m}
              onClick={() => {
                if (sucio && m !== 'editar') return setAviso({ tipo: 'error', texto: 'Guarda o descarta los cambios del plano antes de salir del diseño.' });
                setSel(null); setAviso(null); setModo(m);
              }}
              className={clsx('rounded-lg px-4 py-1.5 text-sm font-medium', modo === m ? 'bg-tinta text-white' : 'text-tinta-suave hover:text-tinta')}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[190px_1fr] xl:grid-cols-[190px_1fr_300px]">
        <Edificio
          pisos={pisos}
          selId={piso?.id ?? null}
          onElegir={(id) => {
            if (sucio && id !== piso?.id) return setAviso({ tipo: 'error', texto: 'Guarda o descarta los cambios de este piso antes de pasar a otro.' });
            setBorrador(null); setPisoId(id); setSel(null);
          }}
          onAgregar={() => setNuevoPiso(true)}
          puedeAgregar={puedeEditar && modo === 'editar'}
          nuevoId={recienCreado}
        />

        <div className="flex min-w-0 flex-col gap-3">
          {/* Barra según el modo */}
          {modo === 'ver' && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-tinta-suave">
              {ESTADOS.map((s) => <span key={s} className="flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm border border-tinta/20" style={{ background: VENTANA_ESTADO[s] }} />{ESTILO_ESTADO[s].etiqueta}</span>)}
              <span className="ml-auto">Haz clic en una habitación para ver sus datos.</span>
            </div>
          )}
          {modo === 'reservar' && (
            <Card className="flex flex-wrap items-end gap-3 p-3">
              <Campo etiqueta="Llegada" className="w-40"><Entrada type="date" min={hoyLima()} value={llegada} onChange={(e) => setLlegada(e.target.value)} /></Campo>
              <Campo etiqueta="Noches" className="w-20"><Entrada type="number" min={1} max={60} value={noches} onChange={(e) => setNoches(Math.max(1, Number(e.target.value)))} /></Campo>
              <Campo etiqueta="Personas" className="w-20"><Entrada type="number" min={1} max={10} value={personas} onChange={(e) => setPersonas(Math.max(1, Number(e.target.value)))} /></Campo>
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Que tenga</span>
                <div className="flex flex-wrap gap-1">
                  {amen.filter((a) => a.activo && a.habitaciones > 0).map((a) => {
                    const on = filtros.includes(a.codigo);
                    return (
                      <button key={a.codigo} title={a.nombre} aria-pressed={on} onClick={() => setFiltros(on ? filtros.filter((f) => f !== a.codigo) : [...filtros, a.codigo])} className={clsx('flex h-8 items-center gap-1 rounded-lg border px-2 text-xs', on ? 'border-acento bg-acento-suave text-acento' : 'border-borde bg-white text-tinta-suave hover:text-tinta')}>
                        <IconoAmenidad icono={a.icono} className="h-4 w-4" /><span className="hidden 2xl:inline">{a.nombre}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <span className="ml-auto rounded-lg bg-desocupada/10 px-3 py-1.5 text-sm font-semibold text-desocupada">{libresVisibles} libres en este piso</span>
            </Card>
          )}
          {modo === 'editar' && borrador && (
            <Card className="flex flex-wrap items-center gap-2 p-2.5">
              <div className="flex items-center gap-1.5 rounded-lg bg-fondo p-1">
                <Selector value={tipoNuevo} onChange={(e) => setTipoNuevo(Number(e.target.value))} className="h-8 w-36" aria-label="Tipo de la habitación nueva">
                  {tipos.data?.filter((t) => t.activo).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </Selector>
                <Button variante="primario" className="h-8" onClick={() => crearHabitacion.mutate()} disabled={crearHabitacion.isPending}>+ Habitación</Button>
              </div>
              {(Object.keys(ELEMENTOS) as TipoElementoPlano[]).map((t) => (
                <button key={t} onClick={() => agregarElemento(t)} className="flex h-9 items-center gap-1.5 rounded-lg border border-borde bg-white pr-2.5 pl-1 text-xs font-medium hover:border-acento" title={`Agregar ${ELEMENTOS[t].nombre.toLowerCase()}`}>
                  <span className="relative h-7 w-7 overflow-hidden rounded"><DibujoElemento tipo={t} ancho={1} alto={1} /></span>+ {ELEMENTOS[t].nombre}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1 text-xs text-tinta-suave">
                Tamaño {borrador.columnas}×{borrador.filas}
                <Button variante="fantasma" className="h-7 px-2" onClick={() => redimensionarPiso(-1, 0)} aria-label="Quitar columna">−↔</Button>
                <Button variante="fantasma" className="h-7 px-2" onClick={() => redimensionarPiso(1, 0)} aria-label="Agregar columna">+↔</Button>
                <Button variante="fantasma" className="h-7 px-2" onClick={() => redimensionarPiso(0, -1)} aria-label="Quitar fila">−↕</Button>
                <Button variante="fantasma" className="h-7 px-2" onClick={() => redimensionarPiso(0, 1)} aria-label="Agregar fila">+↕</Button>
              </div>
            </Card>
          )}
          {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

          {/* Lienzo del piso */}
          <div ref={lienzoRef} className="min-w-0 overflow-x-auto pb-2">
            {piso && (
              <div
                className={clsx('relative mx-auto select-none rounded-xl border-4 border-[#2b3a55] bg-[#f3f0ea] shadow-sm', modo === 'editar' && 'touch-none')}
                style={{
                  width: columnas * celda + 8,
                  height: filas * celda + 8,
                  backgroundImage: modo === 'editar' ? 'linear-gradient(#d9d3c7 1px, transparent 1px), linear-gradient(90deg, #d9d3c7 1px, transparent 1px)' : undefined,
                  backgroundSize: `${celda}px ${celda}px`,
                  backgroundPosition: '0 0',
                }}
                onPointerMove={alMover}
                onPointerUp={alSoltar}
                onClick={() => !arrastre && setSel(null)}
              >
                {(borrador?.elementos ?? piso.elementos.map((e, i) => ({ ...e, clave: `e${e.id ?? i}` }))).map((e) => {
                  const r = arrastre?.clave === e.clave ? arrastre.actual : e;
                  return (
                    <div
                      key={e.clave}
                      className={clsx('absolute', modo === 'editar' && 'cursor-move', sel === e.clave && 'z-10 ring-3 ring-acento', arrastre?.clave === e.clave && (valido ? 'opacity-80' : 'opacity-70 ring-3 ring-ocupada'))}
                      style={{ left: r.x * celda, top: r.y * celda, width: r.ancho * celda, height: r.alto * celda }}
                      onPointerDown={(ev) => alPresionar(ev, e.clave, 'mover')}
                      onClick={(ev) => ev.stopPropagation()}
                      title={e.etiqueta ?? ELEMENTOS[e.tipo].nombre}
                    >
                      <DibujoElemento tipo={e.tipo} ancho={r.ancho} alto={r.alto} />
                      {(e.etiqueta || (e.tipo !== 'PASILLO' && celda * r.ancho >= 90)) && (
                        <span className="pointer-events-none absolute inset-x-0 bottom-0.5 truncate text-center text-[10px] font-semibold text-tinta/80">{e.etiqueta ?? ELEMENTOS[e.tipo].nombre}</span>
                      )}
                      {modo === 'editar' && sel === e.clave && <Asa onPointerDown={(ev) => alPresionar(ev, e.clave, 'tamano')} />}
                    </div>
                  );
                })}
                {piso.habitaciones.map((h) => {
                  const clave = `h${h.id}`;
                  const base = (borrador?.habitaciones[h.id] ?? { x: h.x, y: h.y, ancho: h.ancho, alto: h.alto }) as Rect;
                  const r = arrastre?.clave === clave ? arrastre.actual : base;
                  const d = dispDe(h.id);
                  const apagada = modo === 'reservar' && (!d?.libre || !cumpleFiltro(h));
                  return (
                    <div
                      key={h.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Habitación ${h.numero}, ${h.tipo.nombre}, ${ESTILO_ESTADO[h.estado].etiqueta}`}
                      className={clsx(
                        'absolute rounded-lg transition-[filter,opacity] outline-offset-2',
                        modo === 'editar' ? 'cursor-move' : 'cursor-pointer hover:brightness-[1.04]',
                        sel === clave && 'z-10 ring-4 ring-acento',
                        arrastre?.clave === clave && (valido ? 'z-20 opacity-85 shadow-2xl' : 'z-20 opacity-70 ring-4 ring-ocupada'),
                        apagada && 'opacity-35 grayscale',
                        modo === 'reservar' && d?.libre && !apagada && 'shadow-[0_0_0_3px_var(--color-desocupada)]',
                        modo === 'ver' && h.estancia?.alerta === 'VENCIDA' && 'shadow-[0_0_0_3px_var(--color-ocupada)]',
                        !h.ubicada && modo === 'editar' && 'outline-2 outline-dashed outline-acento',
                      )}
                      style={{ left: r.x * celda, top: r.y * celda, width: r.ancho * celda, height: r.alto * celda }}
                      onPointerDown={(ev) => alPresionar(ev, clave, 'mover')}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (modo === 'reservar' && d?.libre && puedeReservar) setReservando({ habitacionId: h.id, llegada, noches });
                        else setSel(clave);
                      }}
                      onKeyDown={(ev) => { if (ev.key === 'Enter') setSel(clave); }}
                      title={modo === 'reservar' && d && !d.libre ? d.motivo ?? '' : undefined}
                    >
                      <DibujoHabitacion ancho={r.ancho} alto={r.alto} tipo={h.tipo.nombre} adultos={h.tipo.adultos} amenidades={h.amenidades} estado={modo === 'editar' ? null : h.estado} lado={ladoPuerta(r, pasillos)} />
                      <EtiquetasHabitacion h={h} amenidades={amen} celda={celda} modo={modo} disp={d} />
                      {modo === 'editar' && sel === clave && <Asa onPointerDown={(ev) => alPresionar(ev, clave, 'tamano')} />}
                    </div>
                  );
                })}
                {piso.habitaciones.length === 0 && piso.elementos.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-tinta-suave">Piso vacío. {puedeEditar ? 'Entra a «Diseñar plano» para dibujarlo.' : ''}</div>
                )}
              </div>
            )}
          </div>

          {modo === 'editar' && borrador && (
            <div className="flex flex-wrap items-center gap-3">
              <Button variante="primario" disabled={!sucio || guardar.isPending} onClick={() => guardar.mutate(borrador)}>{guardar.isPending ? 'Guardando…' : 'Guardar plano'}</Button>
              <Button disabled={!sucio} onClick={() => { setBorrador(piso ? borradorDe(piso) : null); setSel(null); }}>Descartar cambios</Button>
              <span className="text-xs text-tinta-suave">Arrastra para mover · esquina para cambiar el tamaño · flechas para ajustar (Mayús + flechas: tamaño) · Supr quita un elemento.</span>
            </div>
          )}
        </div>

        {/* Panel derecho */}
        <div className="flex flex-col gap-4 lg:col-span-2 xl:col-span-1">
          {habSel && modo !== 'editar' && (
            <PanelHabitacion
              h={habSel}
              amenidades={amen}
              onCerrar={() => setSel(null)}
              onReservar={puedeReservar ? () => setReservando({ habitacionId: habSel.id, llegada: modo === 'reservar' ? llegada : hoyLima(), noches: modo === 'reservar' ? noches : 1 }) : undefined}
              onTablero={() => navigate('/')}
              onEstancia={puede(sesion, 'estancia.checkout') ? () => setCajon('estancia') : undefined}
              onCheckin={puede(sesion, 'estancia.checkin') ? () => setCajon('checkin') : undefined}
            />
          )}
          {habSel && modo === 'editar' && piso && (
            <EditorHabitacion key={habSel.id} h={habSel} tipos={tipos.data ?? []} amenidades={amen} onAviso={setAviso} onCerrar={() => setSel(null)} />
          )}
          {elemSel && modo === 'editar' && (
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between"><h3 className="font-semibold">{ELEMENTOS[elemSel.tipo].nombre}</h3><button className="text-sm text-tinta-suave" onClick={() => setSel(null)}>Cerrar</button></div>
              <Campo etiqueta="Rótulo (opcional)"><Entrada value={elemSel.etiqueta ?? ''} maxLength={40} onChange={(e) => setBorrador((b) => (b ? { ...b, elementos: b.elementos.map((x) => (x.clave === elemSel.clave ? { ...x, etiqueta: e.target.value || null } : x)) } : b))} placeholder={ELEMENTOS[elemSel.tipo].nombre} /></Campo>
              <p className="text-xs text-tinta-suave">{elemSel.ancho} × {elemSel.alto} celdas. Arrastra la esquina para cambiar el tamaño.</p>
              <Button className="text-ocupada" onClick={() => { setBorrador((b) => (b ? { ...b, elementos: b.elementos.filter((x) => x.clave !== elemSel.clave) } : b)); setSel(null); }}>Quitar del plano</Button>
            </Card>
          )}
          {!sel && modo === 'editar' && (
            <Card className="flex flex-col gap-2 p-4 text-sm">
              <h3 className="font-semibold">Cómo diseñar el piso</h3>
              <ol className="list-decimal space-y-1 pl-5 text-tinta-suave">
                <li>Agrega habitaciones con <b>+ Habitación</b>: salen con número y comodidades de su tipo.</li>
                <li>Agrega pasillos, escaleras o áreas comunes y arrástralos a su lugar.</li>
                <li>Haz clic en una habitación para cambiar su número, tipo o comodidades.</li>
                <li>La puerta se dibuja sola hacia el pasillo más cercano.</li>
                <li>Pulsa <b>Guardar plano</b>.</li>
              </ol>
              <p className="text-xs text-tinta-suave">Para un piso nuevo usa <b>+ Agregar piso</b> sobre el edificio.</p>
            </Card>
          )}
          {!sel && modo === 'ver' && piso && <ResumenPiso piso={piso} />}
          {!sel && modo === 'reservar' && (
            <Card className="p-4 text-sm text-tinta-suave">
              Las habitaciones <b className="text-desocupada">libres</b> en esas fechas se resaltan en verde. Haz clic en una para reservarla; usa los íconos para filtrar por comodidades.
            </Card>
          )}
        </div>
      </div>

      <CajonEstancia habitacionId={cajon === 'estancia' && habSel ? habSel.id : null} numero={habSel?.numero} onCerrar={() => setCajon(null)} />
      <CajonCheckinDirecto
        habitacion={cajon === 'checkin' && habSel ? { id: habSel.id, numero: habSel.numero, tipoId: habSel.tipo.id, capacidad: habSel.tipo.adultos + habSel.tipo.ninos } : null}
        onCerrar={() => setCajon(null)}
      />
      <PanelLateral titulo="Nueva reserva" abierto={!!reservando} onCerrar={() => setReservando(null)}>
        {reservando && (
          <PanelNuevaReserva
            key={JSON.stringify(reservando)}
            inicial={reservando}
            onListo={(r) => { setReservando(null); setAviso({ tipo: 'ok', texto: `Reserva ${r.codigo} registrada para ${r.cliente.nombre} en la ${r.habitaciones[0]?.numero}.` }); }}
          />
        )}
      </PanelLateral>

      {nuevoPiso && (
        <NuevoPiso
          pisos={pisos}
          tipos={tipos.data ?? []}
          onCerrar={() => setNuevoPiso(false)}
          onCreado={(id, n) => {
            setNuevoPiso(false);
            setBorrador(null);
            setPisoId(id);
            setRecienCreado(id);
            setAviso({ tipo: 'ok', texto: `Piso agregado con ${n} habitaciones. Ya puedes moverlas, agregar más o ponerles comodidades.` });
          }}
        />
      )}
    </div>
  );
}

function Asa({ onPointerDown }: { onPointerDown: (e: PE) => void }) {
  return (
    <span
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      className="absolute -right-2 -bottom-2 z-30 h-5 w-5 cursor-se-resize rounded-full border-2 border-white bg-acento shadow"
      aria-label="Cambiar tamaño"
    />
  );
}

function ResumenPiso({ piso }: { piso: PisoPlano }) {
  const cuenta = (e: Estado) => piso.habitaciones.filter((h) => h.estado === e).length;
  const ocupadas = cuenta('OCUPADA');
  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="font-semibold">{piso.nombre}</h3>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-fondo p-2"><div className="text-xl font-bold tabular-nums">{piso.habitaciones.length}</div><div className="text-xs text-tinta-suave">habitaciones</div></div>
        <div className="rounded-lg bg-fondo p-2"><div className="text-xl font-bold tabular-nums">{piso.habitaciones.length ? Math.round((ocupadas / piso.habitaciones.length) * 100) : 0}%</div><div className="text-xs text-tinta-suave">ocupación</div></div>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {ESTADOS.filter((e) => cuenta(e) > 0).map((e) => (
          <li key={e} className="flex items-center justify-between"><span className="flex items-center gap-2"><span className={clsx('h-2.5 w-2.5 rounded-full', ESTILO_ESTADO[e].punto)} />{ESTILO_ESTADO[e].etiqueta}</span><b className="tabular-nums">{cuenta(e)}</b></li>
        ))}
      </ul>
    </Card>
  );
}

function PanelHabitacion({ h, amenidades, onCerrar, onReservar, onTablero, onEstancia, onCheckin }: { h: HabitacionPlano; amenidades: Amenidad[]; onCerrar: () => void; onReservar?: () => void; onTablero: () => void; onEstancia?: () => void; onCheckin?: () => void }) {
  const e = ESTILO_ESTADO[h.estado];
  const lista = h.amenidades.map((c) => amenidades.find((a) => a.codigo === c)).filter((a): a is Amenidad => !!a);
  return (
    <Card className="flex flex-col gap-4 p-4 xl:sticky xl:top-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs tracking-widest text-tinta-suave uppercase">Habitación</div>
          <div className="text-3xl font-bold tabular-nums">{h.numero}</div>
          <div className="text-sm text-tinta-suave">{h.tipo.nombre} · {h.tipo.adultos} adultos{h.tipo.ninos ? ` + ${h.tipo.ninos} niños` : ''}</div>
        </div>
        <button onClick={onCerrar} className="text-sm text-tinta-suave hover:text-tinta">Cerrar</button>
      </div>
      <div className="relative h-36 overflow-hidden rounded-lg border border-borde bg-[#f3f0ea]">
        <DibujoHabitacion ancho={3} alto={2} tipo={h.tipo.nombre} adultos={h.tipo.adultos} amenidades={h.amenidades} estado={h.estado} lado="abajo" />
      </div>
      <div className={clsx('flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold', e.fondo, e.texto)}><span className={clsx('h-2.5 w-2.5 rounded-full', e.punto)} /> {e.etiqueta}</div>
      {h.estancia && (
        <div className="rounded-lg border border-borde p-3 text-sm">
          <div className="font-semibold">{h.estancia.huesped ?? 'Huésped'}</div>
          <div className={clsx('text-xs', h.estancia.alerta === 'VENCIDA' ? 'font-semibold text-ocupada' : 'text-tinta-suave')}>{tiempoRestante(new Date(h.estancia.salidaPrevista), new Date())}</div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-xs tracking-widest text-tinta-suave uppercase">Comodidades</span>
        {lista.length === 0 && <span className="text-sm text-tinta-suave">Sin comodidades registradas.</span>}
        <ul className="grid grid-cols-2 gap-1.5">
          {lista.map((a) => <li key={a.codigo} className="flex items-center gap-1.5 text-sm"><IconoAmenidad icono={a.icono} className="h-4 w-4 flex-none text-acento" />{a.nombre}</li>)}
        </ul>
      </div>
      {h.descripcion && <p className="text-sm text-tinta-suave">{h.descripcion}</p>}
      <div className="flex flex-wrap gap-2">
        {h.estado === 'OCUPADA' && onEstancia && <Button variante="primario" onClick={onEstancia}>Ver estadía: cobro y check-out</Button>}
        {['DESOCUPADA', 'RESERVADA', 'CONFIRMADA'].includes(h.estado) && onCheckin && <Button variante="primario" onClick={onCheckin}>Check-in directo</Button>}
        {onReservar && <Button onClick={onReservar}>Reservar esta habitación</Button>}
        <Button variante="fantasma" onClick={onTablero}>Ir al tablero</Button>
      </div>
    </Card>
  );
}

function EditorHabitacion({ h, tipos, amenidades, onAviso, onCerrar }: { h: HabitacionPlano; tipos: Tipo[]; amenidades: Amenidad[]; onAviso: (a: { tipo: 'ok' | 'error'; texto: string }) => void; onCerrar: () => void }) {
  const qc = useQueryClient();
  const [numero, setNumero] = useState(h.numero);
  const [tipoId, setTipoId] = useState(h.tipo.id);
  const [marcadas, setMarcadas] = useState<string[]>(h.amenidades);
  const [aTodas, setATodas] = useState(false);
  const [nuevaNombre, setNuevaNombre] = useState('');
  const [nuevaIcono, setNuevaIcono] = useState('estrella');
  const [confirmaQuitar, setConfirmaQuitar] = useState(false);
  const refrescar = () => { qc.invalidateQueries({ queryKey: ['plano'] }); qc.invalidateQueries({ queryKey: ['amenidades'] }); qc.invalidateQueries({ queryKey: ['tablero'] }); };
  const datos = useMutation({
    mutationFn: () => api(`/hospedaje/habitaciones/${h.id}`, json('PATCH', { ...(numero !== h.numero && { numero }), ...(tipoId !== h.tipo.id && { tipoHabitacionId: tipoId }) })),
    onSuccess: () => { refrescar(); onAviso({ tipo: 'ok', texto: `Habitación ${numero} actualizada.` }); },
    onError: (e) => onAviso({ tipo: 'error', texto: e.message }),
  });
  const comodidades = useMutation({
    mutationFn: () => api<{ habitaciones: number }>(`/hospedaje/habitaciones/${h.id}/amenidades`, json('PUT', { amenidades: marcadas, aplicarATipo: aTodas })),
    onSuccess: (r) => { refrescar(); onAviso({ tipo: 'ok', texto: r.habitaciones > 1 ? `Comodidades aplicadas a ${r.habitaciones} habitaciones ${h.tipo.nombre}.` : `Comodidades de la ${h.numero} guardadas.` }); },
    onError: (e) => onAviso({ tipo: 'error', texto: e.message }),
  });
  const crearComodidad = useMutation({
    mutationFn: () => api<Amenidad>('/hospedaje/amenidades', json('POST', { nombre: nuevaNombre, icono: nuevaIcono })),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ['amenidades'] }); setMarcadas((m) => [...m, a.codigo]); setNuevaNombre(''); },
    onError: (e) => onAviso({ tipo: 'error', texto: e.message }),
  });
  const quitar = useMutation({
    mutationFn: () => api(`/hospedaje/habitaciones/${h.id}`, json('PATCH', { activo: false })),
    onSuccess: () => { refrescar(); onCerrar(); onAviso({ tipo: 'ok', texto: `Habitación ${h.numero} quitada del plano (desactivada).` }); },
    onError: (e) => onAviso({ tipo: 'error', texto: e.message }),
  });
  const cambioDatos = numero !== h.numero || tipoId !== h.tipo.id;
  const cambioComodidades = aTodas || [...marcadas].sort().join() !== [...h.amenidades].sort().join();

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Habitación {h.numero}</h3><button className="text-sm text-tinta-suave" onClick={onCerrar}>Cerrar</button></div>
      <div className="grid grid-cols-[90px_1fr] gap-2">
        <Campo etiqueta="Número"><Entrada value={numero} maxLength={10} onChange={(e) => setNumero(e.target.value)} /></Campo>
        <Campo etiqueta="Tipo">
          <Selector value={tipoId} onChange={(e) => setTipoId(Number(e.target.value))}>
            {tipos.filter((t) => t.activo || t.id === h.tipo.id).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </Selector>
        </Campo>
      </div>
      {cambioDatos && <Button onClick={() => datos.mutate()} disabled={datos.isPending}>Guardar número y tipo</Button>}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Comodidades</span>
        <div className="grid grid-cols-2 gap-1.5">
          {amenidades.filter((a) => a.activo).map((a) => {
            const on = marcadas.includes(a.codigo);
            return (
              <button key={a.codigo} aria-pressed={on} onClick={() => setMarcadas(on ? marcadas.filter((c) => c !== a.codigo) : [...marcadas, a.codigo])} className={clsx('flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-xs', on ? 'border-acento bg-acento-suave/60 font-medium' : 'border-borde text-tinta-suave hover:text-tinta')}>
                <IconoAmenidad icono={a.icono} className={clsx('h-4 w-4 flex-none', on && 'text-acento')} />{a.nombre}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={aTodas} onChange={(e) => setATodas(e.target.checked)} /> Aplicar a todas las habitaciones {h.tipo.nombre} de la sucursal</label>
        <Button variante="primario" disabled={!cambioComodidades || comodidades.isPending} onClick={() => comodidades.mutate()}>Guardar comodidades</Button>
      </div>

      <details className="rounded-lg border border-borde p-2 text-sm">
        <summary className="cursor-pointer font-medium">+ Nueva comodidad (ej. «Vista al mar»)</summary>
        <div className="mt-2 flex flex-col gap-2">
          <Entrada value={nuevaNombre} maxLength={60} onChange={(e) => setNuevaNombre(e.target.value)} placeholder="Nombre" />
          <div className="flex flex-wrap gap-1">
            {ICONOS_DISPONIBLES.map((i) => (
              <button key={i} type="button" aria-pressed={nuevaIcono === i} onClick={() => setNuevaIcono(i)} className={clsx('rounded-md border p-1', nuevaIcono === i ? 'border-acento bg-acento-suave text-acento' : 'border-borde')}>
                <IconoAmenidad icono={i} className="h-4 w-4" />
              </button>
            ))}
          </div>
          <Button disabled={nuevaNombre.trim().length < 2 || crearComodidad.isPending} onClick={() => crearComodidad.mutate()}>Crear y marcar</Button>
        </div>
      </details>

      {confirmaQuitar ? (
        <div className="flex flex-col gap-2 rounded-lg bg-ocupada/5 p-3 text-sm">
          <span>¿Quitar la habitación {h.numero}? Se desactiva y deja de venderse; su historial se conserva.</span>
          <div className="flex gap-2">
            <Button className="text-ocupada" disabled={quitar.isPending} onClick={() => quitar.mutate()}>Sí, quitar</Button>
            <Button variante="fantasma" onClick={() => setConfirmaQuitar(false)}>No</Button>
          </div>
        </div>
      ) : (
        <Button className="text-ocupada" onClick={() => setConfirmaQuitar(true)}>Quitar habitación…</Button>
      )}
    </Card>
  );
}

function NuevoPiso({ pisos, tipos, onCerrar, onCreado }: { pisos: PisoPlano[]; tipos: Tipo[]; onCerrar: () => void; onCreado: (id: number, habitaciones: number) => void }) {
  const qc = useQueryClient();
  const siguiente = Math.max(0, ...pisos.map((p) => p.numero)) + 1;
  const [numero, setNumero] = useState(siguiente);
  const [nombre, setNombre] = useState(`Piso ${siguiente}`);
  const [cantidad, setCantidad] = useState(6);
  const activos = tipos.filter((t) => t.activo);
  const [tipoId, setTipoId] = useState<number | ''>(activos[0]?.id ?? '');
  const vista = distribucionInicial(cantidad);
  const crear = useMutation({
    mutationFn: () => api<{ id: number; habitaciones: string[] }>('/hospedaje/plano/pisos', json('POST', { numero, nombre, habitaciones: cantidad, tipoHabitacionId: tipoId || undefined })),
    onSuccess: async (r) => { await qc.invalidateQueries({ queryKey: ['plano'] }); qc.invalidateQueries({ queryKey: ['tablero'] }); onCreado(r.id, r.habitaciones.length); },
  });
  const escala = Math.min(300 / vista.columnas, 160 / vista.filas);
  const tipoNombre = activos.find((t) => t.id === tipoId)?.nombre ?? '';
  const adultos = activos.find((t) => t.id === tipoId)?.capacidadAdultos ?? 2;

  return (
    <PanelLateral titulo="Agregar un piso al hotel" abierto onCerrar={onCerrar}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[90px_1fr] gap-3">
          <Campo etiqueta="Número"><Entrada type="number" value={numero} onChange={(e) => { const n = Number(e.target.value); setNumero(n); if (/^Piso -?\d*$/.test(nombre)) setNombre(`Piso ${n}`); }} /></Campo>
          <Campo etiqueta="Nombre"><Entrada value={nombre} maxLength={50} onChange={(e) => setNombre(e.target.value)} /></Campo>
        </div>
        <Campo etiqueta={`Habitaciones: ${cantidad}`} ayuda="Se numeran como el piso: 401, 402…">
          <input type="range" min={0} max={16} value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))} className="accent-[var(--color-acento)]" />
        </Campo>
        <Campo etiqueta="Tipo de las habitaciones" ayuda="Luego puedes cambiar el tipo de cada una">
          <Selector value={tipoId} onChange={(e) => setTipoId(Number(e.target.value))}>
            {activos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </Selector>
        </Campo>
        <div className="flex flex-col gap-1">
          <span className="text-xs tracking-widest text-tinta-suave uppercase">Vista previa</span>
          <div className="relative mx-auto rounded-md border-[3px] border-[#2b3a55] bg-[#f3f0ea]" style={{ width: vista.columnas * escala + 6, height: vista.filas * escala + 6 }}>
            {[{ ...vista.pasillo, t: 'PASILLO' as const }, { ...vista.escalera, t: 'ESCALERA' as const }].map((e) => (
              <div key={e.t} className="absolute" style={{ left: e.x * escala, top: e.y * escala, width: e.ancho * escala, height: e.alto * escala }}><DibujoElemento tipo={e.t} ancho={e.ancho} alto={e.alto} /></div>
            ))}
            {vista.habitaciones.map((r, i) => (
              <div key={i} className="absolute animate-[caer_.4s_ease-out]" style={{ left: r.x * escala, top: r.y * escala, width: r.ancho * escala, height: r.alto * escala }}>
                <DibujoHabitacion ancho={r.ancho} alto={r.alto} tipo={tipoNombre} adultos={adultos} amenidades={[]} estado={null} lado={ladoPuerta(r, [vista.pasillo])} />
                <span className="absolute top-0.5 left-1 text-[9px] font-bold">{numero}{String(i + 1).padStart(2, '0')}</span>
              </div>
            ))}
          </div>
        </div>
        {crear.error && <Aviso>{crear.error.message}</Aviso>}
        <Button variante="primario" disabled={!nombre.trim() || (cantidad > 0 && !tipoId) || crear.isPending} onClick={() => crear.mutate()}>{crear.isPending ? 'Construyendo…' : `Agregar ${nombre}`}</Button>
      </div>
    </PanelLateral>
  );
}

