import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type Cliente, type Estancia, type MetodoPago, type Producto, type ResultadoCheckout, type SerieParaEmitir, type Tablero } from '../../lib/api';
import { puede, useSesion } from '../auth/sesion';
import { soles } from '../hospedaje/formato';
import { horaLima } from '../reservas/fechas';
import { ElegirHuesped } from '../reservas/PanelNuevaReserva';
import { Button } from '../../components/ui/Button';
import { Aviso, Entrada, Selector } from '../../components/ui/form';

const json = (method: string, cuerpo?: unknown) => ({ method, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
const cent = (s: string | number) => Math.round(Number(s) * 100);

/** Invalida todo lo que cambia con una estadía: tablero, plano, reservas y caja. */
export function useRefrescarHotel() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['tablero', 'plano', 'reservas', 'caja', 'estancia', 'comprobantes']) qc.invalidateQueries({ queryKey: [k] });
  };
}

// ── Cuenta ──────────────────────────────────────────────────────

export function TablaCuenta({ e }: { e: Estancia }) {
  const c = e.cuenta;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-borde p-3 text-sm">
      {c.lineas.map((l, i) => (
        <div key={i} className={clsx('flex justify-between gap-3', l.tipo === 'CARGO' && 'text-tinta-suave')}>
          <span>{l.tipo === 'CARGO' && l.cantidad !== 1 ? `${l.cantidad} × ` : ''}{l.descripcion}</span>
          <span className="whitespace-nowrap tabular-nums">{soles(l.total)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-borde pt-1 font-semibold"><span>Total</span><span className="tabular-nums">{soles(c.total)}</span></div>
      {cent(c.adelanto) > 0 && <div className="flex justify-between text-tinta-suave"><span>Adelanto ({c.reserva?.codigo})</span><span className="tabular-nums">− {soles(c.adelanto)}</span></div>}
      <div className="flex justify-between text-base font-bold text-acento"><span>Saldo por cobrar</span><span className="tabular-nums">{soles(c.saldo)}</span></div>
      {cent(c.comision.monto) > 0 && <div className="text-xs text-tinta-suave">Comisión del canal {Number(c.comision.porcentaje)} %: {soles(c.comision.monto)} (no se cobra al huésped; queda para el reporte de ventas)</div>}
    </div>
  );
}

// ── Check-out y cobro ───────────────────────────────────────────

interface FilaPago { metodoPagoId: number; monto: string; referencia: string }

export function PanelCheckout({ e, onListo, onVolver }: { e: Estancia; onListo: (r: ResultadoCheckout) => void; onVolver: () => void }) {
  const refrescar = useRefrescarHotel();
  const { data: sesion } = useSesion();
  const metodos = useQuery({ queryKey: ['caja', 'metodos'], queryFn: () => api<MetodoPago[]>('/caja/metodos-pago') });
  const [tipo, setTipo] = useState<'BOLETA' | 'FACTURA' | 'INTERNO'>('BOLETA');
  const [empresa, setEmpresa] = useState<Cliente | null>(null);
  // Boleta a nombre de otra persona (S-07 D9); por defecto, el titular
  const [otraPersona, setOtraPersona] = useState<Cliente | null>(null);
  const [aOtro, setAOtro] = useState(false);
  // Descuento global (RF-FAC-08): en soles o %, con motivo; lo valida la API
  const [conDescuento, setConDescuento] = useState(false);
  const [desc, setDesc] = useState<{ tipo: 'MONTO' | 'PORCENTAJE'; valor: string; motivo: string }>({ tipo: 'MONTO', valor: '', motivo: '' });
  const total = cent(e.cuenta.total);
  const descCent = !conDescuento || !(Number(desc.valor) > 0) ? 0 : desc.tipo === 'MONTO' ? cent(desc.valor) : Math.round((total * Number(desc.valor)) / 100);
  const descError = !conDescuento ? null : !(Number(desc.valor) > 0) ? 'Indica el descuento' : descCent > total - cent(e.cuenta.adelanto) ? 'El descuento no puede bajar el total por debajo del adelanto' : desc.motivo.trim().length < 5 ? 'Escribe el motivo (5 caracteres o más)' : null;
  const serie = useQuery({ queryKey: ['serie-para-emitir', tipo], queryFn: () => api<SerieParaEmitir>(`/facturacion/series/para-emitir?tipo=${tipo}`), retry: false });
  const saldo = cent(e.cuenta.saldo) - descCent;
  const saldoTexto = (saldo / 100).toFixed(2);
  const efectivo = metodos.data?.find((m) => m.es_efectivo);
  const [pagos, setPagos] = useState<FilaPago[]>([]);
  const filas = pagos.length || saldo === 0 ? pagos : efectivo ? [{ metodoPagoId: efectivo.id, monto: saldoTexto, referencia: '' }] : [];
  const esEfectivo = (id: number) => !!metodos.data?.find((m) => m.id === id)?.es_efectivo;
  const entregado = filas.reduce((s, p) => s + cent(p.monto || 0), 0);
  const noEfectivo = filas.filter((p) => !esEfectivo(p.metodoPagoId)).reduce((s, p) => s + cent(p.monto || 0), 0);
  const vuelto = Math.max(0, entregado - saldo);
  const falta = Math.max(0, saldo - entregado);
  const error = noEfectivo > saldo ? 'Con tarjeta, Yape o transferencia no hay vuelto: baja el monto.' : falta > 0 ? `Falta cobrar ${soles(falta / 100)}` : null;

  const cobrar = useMutation({
    mutationFn: () =>
      api<ResultadoCheckout>(`/estancias/${e.id}/checkout`, json('POST', {
        tipoComprobante: tipo,
        clienteId: tipo === 'FACTURA' ? empresa?.id : tipo === 'BOLETA' && aOtro ? otraPersona?.id : undefined,
        descuento: conDescuento ? { tipo: desc.tipo, valor: Number(desc.valor), motivo: desc.motivo } : undefined,
        pagos: filas.filter((p) => Number(p.monto) > 0).map((p) => ({ metodoPagoId: p.metodoPagoId, monto: Number(p.monto), referencia: p.referencia || null })),
      })),
    onSuccess: (r) => { refrescar(); onListo(r); },
  });
  const poner = (i: number, cambio: Partial<FilaPago>) => setPagos(filas.map((p, j) => (j === i ? { ...p, ...cambio } : p)));
  const habitaciones = e.grupo.map((g) => g.habitacion).join(' y ');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Check-out {e.grupo.length > 1 ? `de las habitaciones ${habitaciones}` : `de la ${e.habitacion.numero}`}</h3>
        <button className="text-sm text-tinta-suave hover:text-tinta" onClick={onVolver}>Volver</button>
      </div>
      <TablaCuenta e={e} />

      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Comprobante</span>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-fondo p-1" role="radiogroup">
          {([['BOLETA', 'Boleta'], ['FACTURA', 'Factura'], ['INTERNO', 'Nota interna']] as const).map(([t, texto]) => (
            <button key={t} role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)} className={clsx('rounded-md py-1.5 text-sm font-medium', tipo === t ? 'bg-white shadow-sm' : 'text-tinta-suave')}>{texto}</button>
          ))}
        </div>
        <span className="text-xs text-tinta-suave">
          {tipo === 'FACTURA' ? 'A nombre de una empresa con RUC.' : tipo === 'BOLETA' ? `A nombre de ${aOtro && otraPersona ? otraPersona.nombre : (e.huespedes.find((h) => h.titular)?.nombre ?? 'el titular')}.` : 'Uso interno: no se envía a SUNAT.'}
          {tipo !== 'INTERNO' && ' El envío a SUNAT se activa en la fase de facturación (F3).'}
        </span>
        <span className="text-xs">
          {serie.data ? <>Se emitirá como <b className="font-mono">{serie.data.siguiente}</b></> : serie.error ? <span className="text-ocupada">{serie.error.message}</span> : null}
        </span>
        {tipo === 'BOLETA' && (
          <label className="flex items-center gap-2 text-xs text-tinta-suave">
            <input type="checkbox" checked={aOtro} onChange={(ev) => setAOtro(ev.target.checked)} /> A nombre de otra persona
          </label>
        )}
        {tipo === 'BOLETA' && aOtro && <ElegirHuesped valor={otraPersona} onCambio={setOtraPersona} />}
      </div>

      {puede(sesion, 'descuento.aplicar') && (
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" checked={conDescuento} onChange={(ev) => { setConDescuento(ev.target.checked); setPagos([]); }} /> Descuento global
          </label>
          {conDescuento && (
            <div className="flex flex-col gap-2 rounded-lg border border-borde p-2">
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <Selector value={desc.tipo} onChange={(ev) => { setDesc({ ...desc, tipo: ev.target.value as 'MONTO' | 'PORCENTAJE' }); setPagos([]); }} aria-label="Tipo de descuento">
                  <option value="MONTO">En soles</option>
                  <option value="PORCENTAJE">En %</option>
                </Selector>
                <Entrada type="number" min={0} step="0.10" value={desc.valor} onChange={(ev) => { setDesc({ ...desc, valor: ev.target.value }); setPagos([]); }} aria-label="Valor del descuento" placeholder={desc.tipo === 'MONTO' ? 'S/' : '%'} />
              </div>
              <Entrada value={desc.motivo} maxLength={250} onChange={(ev) => setDesc({ ...desc, motivo: ev.target.value })} placeholder="Motivo (ej. cliente frecuente)" aria-label="Motivo del descuento" />
              {descCent > 0 && <span className="text-xs text-tinta-suave">Descuento de {soles(descCent / 100)} sobre el total; las líneas no cambian. Queda registrado con tu usuario.</span>}
              {descError && <span className="text-xs text-ocupada">{descError}</span>}
            </div>
          )}
        </div>
      )}
      {tipo === 'FACTURA' && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Empresa (RUC)</span>
          <ElegirHuesped valor={empresa} onCambio={setEmpresa} />
          {empresa && !empresa.documento.startsWith('RUC') && <span className="text-xs text-ocupada">Elige un cliente con RUC.</span>}
        </div>
      )}

      {saldo > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Pagos</span>
          <div className="flex flex-wrap gap-1">
            {metodos.data?.filter((m) => m.codigo !== 'OTA').map((m) => (
              <button key={m.id} onClick={() => setPagos([{ metodoPagoId: m.id, monto: saldoTexto, referencia: '' }])} className="rounded-md border border-borde px-2 py-1 text-xs hover:border-acento">
                Todo en {m.descripcion.toLowerCase()}
              </button>
            ))}
          </div>
          {filas.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_100px_auto] items-end gap-2">
              <Selector value={p.metodoPagoId} onChange={(ev) => poner(i, { metodoPagoId: Number(ev.target.value) })} aria-label="Método de pago">
                {metodos.data?.map((m) => <option key={m.id} value={m.id}>{m.descripcion}</option>)}
              </Selector>
              <Entrada type="number" min={0} step="0.10" value={p.monto} onChange={(ev) => poner(i, { monto: ev.target.value })} aria-label="Monto" />
              <button className="h-9 px-1 text-tinta-suave hover:text-ocupada" onClick={() => setPagos(filas.filter((_, j) => j !== i))} aria-label="Quitar pago">✕</button>
              {!esEfectivo(p.metodoPagoId) && (
                <Entrada className="col-span-3 h-8 text-xs" value={p.referencia} onChange={(ev) => poner(i, { referencia: ev.target.value })} placeholder="N.º de operación (opcional)" />
              )}
            </div>
          ))}
          <button className="self-start text-sm font-medium text-acento hover:underline" onClick={() => setPagos([...filas, { metodoPagoId: metodos.data?.find((m) => m.codigo === 'YAPE')?.id ?? metodos.data![0].id, monto: falta ? (falta / 100).toFixed(2) : '', referencia: '' }])}>
            + Dividir el pago (ej. parte en efectivo y parte con Yape)
          </button>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-fondo p-2"><div className="text-xs text-tinta-suave">Recibido</div><b className="tabular-nums">{soles(entregado / 100)}</b></div>
            <div className={clsx('rounded-lg p-2', vuelto > 0 ? 'bg-desocupada/10' : 'bg-fondo')}><div className="text-xs text-tinta-suave">Vuelto</div><b className="tabular-nums">{soles(vuelto / 100)}</b></div>
          </div>
        </div>
      ) : (
        <Aviso tipo="info">{descCent > 0 ? 'Con el descuento, la cuenta queda pagada.' : 'La cuenta ya está pagada (adelanto o canal).'} Solo se emite el comprobante.</Aviso>
      )}
      {error && saldo > 0 && <Aviso>{error}</Aviso>}
      {cobrar.error && <Aviso>{cobrar.error.message}</Aviso>}
      <Button variante="primario" className="h-11" disabled={(saldo > 0 && !!error) || cobrar.isPending || !!descError || !serie.data || (tipo === 'FACTURA' && !empresa?.documento.startsWith('RUC')) || (tipo === 'BOLETA' && aOtro && !otraPersona)} onClick={() => cobrar.mutate()}>
        {cobrar.isPending ? 'Cobrando…' : `Cobrar ${soles(saldoTexto)} y hacer check-out`}
      </Button>
      <p className="text-xs text-tinta-suave">Al confirmar se emite el comprobante, el pago entra a la caja y {e.grupo.length > 1 ? 'las habitaciones pasan' : 'la habitación pasa'} a limpieza.</p>
    </div>
  );
}

// ── Extensión y traslado ────────────────────────────────────────

/** Suma turnos al mismo precio (RF-RES-13) o lleva al huésped a otra habitación con su motivo (RF-RES-14). */
function ExtenderOTrasladar({ e, onCambio }: { e: Estancia; onCambio: () => void }) {
  const [modo, setModo] = useState<'extender' | 'trasladar' | null>(null);
  const [turnos, setTurnos] = useState('1');
  const [destino, setDestino] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const tablero = useQuery({ queryKey: ['tablero'], queryFn: () => api<Tablero>('/hospedaje/tablero'), enabled: modo === 'trasladar' });
  const libres = (tablero.data?.pisos.flatMap((pi) => pi.habitaciones) ?? []).filter(
    (h) => h.id !== e.habitacion.id && !h.estancia && ['DESOCUPADA', 'RESERVADA', 'CONFIRMADA'].includes(h.estado),
  );
  const n = Number(turnos);
  const accion = useMutation({
    mutationFn: () =>
      modo === 'extender'
        ? api<Estancia>(`/estancias/${e.id}/extension`, json('POST', { turnos: n }))
        : api<Estancia>(`/estancias/${e.id}/traslado`, json('POST', { habitacionId: destino, motivo })),
    onSuccess: () => { setModo(null); setMotivo(''); setDestino(null); setTurnos('1'); onCambio(); },
  });
  const unidad = e.horasTurno === 24 ? 'noche' : `turno de ${e.horasTurno} h`;

  if (!modo) {
    return (
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => setModo('extender')}>Extender estadía</Button>
        <Button className="flex-1" onClick={() => setModo('trasladar')}>Cambiar de habitación</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-borde p-3 text-sm">
      {modo === 'extender' ? (
        <>
          <span className="font-medium">Extender la estadía</span>
          <div className="flex items-center gap-2">
            <Entrada type="number" min={1} max={30} className="h-9 w-20" value={turnos} onChange={(ev) => setTurnos(ev.target.value)} aria-label="Turnos a agregar" />
            <span>{n === 1 ? unidad : `${unidad === 'noche' ? 'noches' : `turnos de ${e.horasTurno} h`}`} más a {soles(e.precio)} = <b className="tabular-nums">{soles(Number(e.precio) * (Number.isInteger(n) && n > 0 ? n : 0))}</b></span>
          </div>
          <span className="text-xs text-tinta-suave">Mismo precio pactado. Si la habitación ya está reservada para después, el sistema no lo permite.</span>
        </>
      ) : (
        <>
          <span className="font-medium">Cambiar de habitación</span>
          <Selector value={destino ?? ''} onChange={(ev) => setDestino(Number(ev.target.value) || null)} aria-label="Habitación de destino">
            <option value="">Elige una habitación libre…</option>
            {libres.map((h) => <option key={h.id} value={h.id}>{h.numero} · {h.tipo} · {h.capacidad} pers.</option>)}
          </Selector>
          <Entrada value={motivo} maxLength={200} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Motivo (ej. fuga de agua en el baño)" />
          <span className="text-xs text-tinta-suave">El precio pactado no cambia. La habitación {e.habitacion.numero} pasa a limpieza.</span>
        </>
      )}
      {accion.error && <Aviso>{accion.error.message}</Aviso>}
      <div className="flex gap-2">
        <Button
          variante="primario"
          disabled={accion.isPending || (modo === 'extender' ? !(Number.isInteger(n) && n >= 1 && n <= 30) : !destino || motivo.trim().length < 5)}
          onClick={() => accion.mutate()}
        >
          {modo === 'extender' ? 'Extender' : 'Trasladar'}
        </Button>
        <Button variante="fantasma" onClick={() => setModo(null)}>Volver</Button>
      </div>
    </div>
  );
}

// ── Estadía en curso ────────────────────────────────────────────

export function PanelEstancia({ estanciaId, habitacionId, onComprobante }: { estanciaId?: number; habitacionId?: number; onComprobante: (r: ResultadoCheckout) => void }) {
  const refrescar = useRefrescarHotel();
  const { data: sesion } = useSesion();
  // Una vez cargada se sigue por su id: tras un traslado, la estadía ya no está en la habitación de origen.
  const [fija, setFija] = useState<number | undefined>(estanciaId);
  const ruta = fija ? `/estancias/${fija}` : `/estancias/habitacion/${habitacionId}`;
  const q = useQuery({ queryKey: ['estancia', ruta], queryFn: () => api<Estancia>(ruta) });
  useEffect(() => {
    if (q.data && !fija) setFija(q.data.id);
  }, [q.data, fija]);
  const productos = useQuery({ queryKey: ['productos'], queryFn: () => api<Producto[]>('/productos') });
  const [modo, setModo] = useState<'ver' | 'checkout'>('ver');
  const [agregando, setAgregando] = useState(false);
  const [acompanante, setAcompanante] = useState<Cliente | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [libre, setLibre] = useState({ descripcion: '', precio: '' });
  const e = q.data;
  const cambio = useMutation({
    mutationFn: ({ ruta: r, metodo, cuerpo }: { ruta: string; metodo: string; cuerpo?: unknown }) => api<Estancia>(r, json(metodo, cuerpo)),
    onSuccess: () => { refrescar(); setAcompanante(null); setLibre({ descripcion: '', precio: '' }); setCantidad(1); },
  });
  const categorias = useMemo(() => [...new Set(productos.data?.map((p) => p.categoria))], [productos.data]);

  if (q.isLoading) return <p className="text-sm text-tinta-suave">Cargando la estadía…</p>;
  if (q.error || !e) return <Aviso>{q.error?.message ?? 'Sin estadía'}</Aviso>;
  if (modo === 'checkout') return <PanelCheckout e={e} onVolver={() => setModo('ver')} onListo={onComprobante} />;
  const puedeCobrar = puede(sesion, 'estancia.checkout');

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-fondo p-2"><div className="text-xs text-tinta-suave">Entró</div><b>{horaLima(e.checkin)}</b></div>
        <div className={clsx('rounded-lg p-2', Date.parse(e.salidaPrevista) < Date.now() ? 'bg-ocupada/10 text-ocupada' : 'bg-fondo')}><div className="text-xs text-tinta-suave">Sale</div><b>{horaLima(e.salidaPrevista)}</b></div>
        <div className="col-span-2 text-xs text-tinta-suave"><b className="text-tinta">Habitación {e.habitacion.numero}</b> · {e.cantidad} × {e.horasTurno === 24 ? 'noche' : `turno de ${e.horasTurno} h`} a {soles(e.precio)} · {e.canal}{e.reserva ? ` · reserva ${e.reserva}` : ' · sin reserva'}{e.procedencia ? ` · viene de ${e.procedencia}` : ''}{e.destino ? ` · sigue a ${e.destino}` : ''}{e.motivoViaje ? ` · ${e.motivoViaje.toLowerCase()}` : ''}</div>
      </div>

      {puede(sesion, 'estancia.checkin') && <ExtenderOTrasladar e={e} onCambio={refrescar} />}

      <div className="flex flex-col gap-2">
        <span className="text-xs tracking-widest text-tinta-suave uppercase">Huéspedes ({e.huespedes.length}/{e.habitacion.capacidad})</span>
        {e.huespedes.map((h) => (
          <div key={h.id} className="flex items-center justify-between text-sm">
            <span>{h.nombre}{h.titular && <span className="ml-1.5 rounded bg-acento-suave px-1.5 text-[10px] font-semibold text-acento">TITULAR</span>}</span>
            <span className="text-xs text-tinta-suave">{h.documento}</span>
          </div>
        ))}
        {e.huespedes.length < e.habitacion.capacidad && puede(sesion, 'estancia.checkin') && (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-borde p-2">
            <span className="text-xs font-medium">+ Acompañante</span>
            <ElegirHuesped valor={acompanante} onCambio={setAcompanante} />
            {acompanante && <Button onClick={() => cambio.mutate({ ruta: `/estancias/${e.id}/huespedes`, metodo: 'POST', cuerpo: { clienteId: acompanante.id } })}>Registrar a {acompanante.nombre}</Button>}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs tracking-widest text-tinta-suave uppercase">Consumos y cargos</span>
          {puedeCobrar && !agregando && <button className="text-sm font-medium text-acento hover:underline" onClick={() => setAgregando(true)}>+ Agregar</button>}
        </div>
        {e.cargos.length === 0 && !agregando && <span className="text-sm text-tinta-suave">Sin consumos.</span>}
        {e.cargos.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
            <span>{c.cantidad !== 1 ? `${c.cantidad} × ` : ''}{c.descripcion}</span>
            <span className="flex items-center gap-2 tabular-nums">{soles(c.total)}{puedeCobrar && <button className="text-xs text-tinta-suave hover:text-ocupada" aria-label={`Anular ${c.descripcion}`} onClick={() => cambio.mutate({ ruta: `/estancias/${e.id}/cargos/${c.id}`, metodo: 'DELETE' })}>✕</button>}</span>
          </div>
        ))}
        {agregando && (
          <div className="flex flex-col gap-2 rounded-lg border border-borde p-2">
            <div className="flex items-center gap-2 text-sm">Cantidad <Entrada type="number" min={1} max={99} value={cantidad} onChange={(ev) => setCantidad(Math.max(1, Number(ev.target.value)))} className="h-8 w-16" /></div>
            {categorias.map((cat) => (
              <div key={cat} className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-tinta-suave uppercase">{cat}</span>
                <div className="flex flex-wrap gap-1">
                  {productos.data?.filter((p) => p.categoria === cat).map((p) => (
                    <button key={p.id} disabled={cambio.isPending} onClick={() => cambio.mutate({ ruta: `/estancias/${e.id}/cargos`, metodo: 'POST', cuerpo: { productoId: p.id, cantidad } })} className="rounded-md border border-borde bg-white px-2 py-1 text-xs hover:border-acento">
                      {p.nombre} · <b>{soles(p.precio)}</b>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_80px_auto] gap-1">
              <Entrada className="h-8" placeholder="Otro cargo (ej. hora extra)" value={libre.descripcion} onChange={(ev) => setLibre({ ...libre, descripcion: ev.target.value })} />
              <Entrada className="h-8" type="number" min={0} placeholder="S/" value={libre.precio} onChange={(ev) => setLibre({ ...libre, precio: ev.target.value })} />
              <Button className="h-8" disabled={!libre.descripcion.trim() || libre.precio === ''} onClick={() => cambio.mutate({ ruta: `/estancias/${e.id}/cargos`, metodo: 'POST', cuerpo: { descripcion: libre.descripcion, precio: Number(libre.precio), cantidad } })}>Agregar</Button>
            </div>
            <button className="self-start text-xs text-tinta-suave" onClick={() => setAgregando(false)}>Listo</button>
          </div>
        )}
      </div>
      {cambio.error && <Aviso>{cambio.error.message}</Aviso>}

      <TablaCuenta e={e} />
      {e.grupo.length > 1 && <Aviso tipo="info">Esta reserva tiene {e.grupo.length} habitaciones ({e.grupo.map((g) => g.habitacion).join(', ')}): se cobran juntas en un solo comprobante.</Aviso>}
      {puedeCobrar && <Button variante="primario" className="h-11" onClick={() => setModo('checkout')}>Check-out y cobrar {soles(e.cuenta.saldo)}</Button>}
    </div>
  );
}
