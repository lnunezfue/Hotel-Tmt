import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type EstadoCaja, type SesionCaja } from '../lib/api';
import { puede, useSesion } from '../features/auth/sesion';
import { soles } from '../features/hospedaje/formato';
import { horaCorta, horaLima } from '../features/reservas/fechas';
import { VistaComprobante } from '../features/estancias/VistaComprobante';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Aviso, Campo, Entrada, PanelLateral, Pildora, Selector } from '../components/ui/form';

const json = (cuerpo: unknown) => ({ method: 'POST', body: JSON.stringify(cuerpo) });
interface FilaComprobante { id: number; tipo: string; numero: string; cliente: string; total: string; estadoSunat: string; hora: string }

/** Caja de recepción: apertura, cobros del turno, gastos y cierre con arqueo (spec S-07 §5). */
export function CajaPage() {
  const qc = useQueryClient();
  const { data: sesion } = useSesion();
  const caja = useQuery({ queryKey: ['caja'], queryFn: () => api<EstadoCaja>('/caja'), refetchInterval: 30_000 });
  const comprobantes = useQuery({ queryKey: ['comprobantes', 'hoy'], queryFn: () => api<FilaComprobante[]>('/comprobantes') });
  const [monto, setMonto] = useState('100');
  const [mov, setMov] = useState({ concepto: 'GASTO', monto: '', descripcion: '' });
  const [contado, setContado] = useState('');
  const [cierre, setCierre] = useState<SesionCaja | null>(null);
  const [verComp, setVerComp] = useState<number | null>(null);
  const refrescar = () => { qc.invalidateQueries({ queryKey: ['caja'] }); qc.invalidateQueries({ queryKey: ['comprobantes'] }); };

  const abrir = useMutation({ mutationFn: () => api('/caja/abrir', json({ monto: Number(monto) })), onSuccess: () => { setCierre(null); refrescar(); } });
  const movimiento = useMutation({ mutationFn: () => api('/caja/movimientos', json({ ...mov, monto: Number(mov.monto) })), onSuccess: () => { setMov({ concepto: 'GASTO', monto: '', descripcion: '' }); refrescar(); } });
  const cerrar = useMutation({ mutationFn: () => api<SesionCaja>('/caja/cerrar', json({ montoDeclarado: Number(contado) })), onSuccess: (r) => { setCierre(r); setContado(''); refrescar(); } });

  const s = caja.data?.sesion;
  const diferencia = contado !== '' && s ? Number(contado) - Number(s.efectivoEsperado) : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs text-tinta-suave">Hotel / Caja</div>
          <h1 className="text-2xl font-bold">Caja de recepción</h1>
        </div>
        {s && <Pildora className="bg-desocupada/10 text-desocupada">Abierta por {s.usuario} · {horaLima(s.apertura)}</Pildora>}
      </header>
      {caja.error && <Aviso>{caja.error.message}</Aviso>}

      {cierre && (
        <Card className={clsx('flex flex-col gap-2 p-5', Number(cierre.diferencia) === 0 ? 'border-desocupada/40' : 'border-limpieza/50')}>
          <h2 className="text-lg font-semibold">Caja cerrada</h2>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><div className="text-xs text-tinta-suave">Efectivo esperado</div><b className="text-lg tabular-nums">{soles(cierre.esperado!)}</b></div>
            <div><div className="text-xs text-tinta-suave">Contado</div><b className="text-lg tabular-nums">{soles(cierre.declarado!)}</b></div>
            <div><div className="text-xs text-tinta-suave">{Number(cierre.diferencia) < 0 ? 'Faltante' : Number(cierre.diferencia) > 0 ? 'Sobrante' : 'Diferencia'}</div><b className={clsx('text-lg tabular-nums', Number(cierre.diferencia) < 0 ? 'text-ocupada' : Number(cierre.diferencia) > 0 ? 'text-limpieza' : 'text-desocupada')}>{soles(Math.abs(Number(cierre.diferencia)))}</b></div>
          </div>
        </Card>
      )}

      {!s ? (
        <Card className="flex max-w-md flex-col gap-4 p-5">
          <h2 className="text-lg font-semibold">La caja está cerrada</h2>
          <p className="text-sm text-tinta-suave">Ábrela al empezar el turno con el efectivo que hay en el cajón (sencillo para dar vuelto). Sin caja abierta no se pueden cobrar check-outs ni adelantos.</p>
          {puede(sesion, 'caja.abrir') ? (
            <>
              <Campo etiqueta="Efectivo inicial (S/)"><Entrada type="number" min={0} step="0.10" value={monto} onChange={(e) => setMonto(e.target.value)} /></Campo>
              {abrir.error && <Aviso>{abrir.error.message}</Aviso>}
              <Button variante="primario" disabled={monto === '' || abrir.isPending} onClick={() => abrir.mutate()}>Abrir caja con {soles(Number(monto || 0))}</Button>
            </>
          ) : (
            <Aviso tipo="info">Tu rol no abre caja.</Aviso>
          )}
          {caja.data?.ultimoCierre && !cierre && (
            <p className="text-xs text-tinta-suave">Último cierre: {horaLima(caja.data.ultimoCierre.cierre)} por {caja.data.ultimoCierre.usuario} · diferencia {soles(caja.data.ultimoCierre.diferencia)}</p>
          )}
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Card className="p-4"><div className="text-2xl font-bold tabular-nums">{soles(s.efectivoEsperado)}</div><div className="text-xs text-tinta-suave">Efectivo que debe haber</div></Card>
              {s.porMetodo.filter((m) => !m.efectivo).map((m) => (
                <Card key={m.codigo} className="p-4"><div className="text-2xl font-bold tabular-nums">{soles(Number(m.ingresos) - Number(m.egresos))}</div><div className="text-xs text-tinta-suave">{m.metodo}</div></Card>
              ))}
              <Card className="p-4"><div className="text-2xl font-bold tabular-nums">{comprobantes.data?.length ?? 0}</div><div className="text-xs text-tinta-suave">Comprobantes de hoy</div></Card>
            </div>
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-fondo text-left text-xs tracking-wide text-tinta-suave uppercase">
                  <tr><th className="px-4 py-2">Hora</th><th className="px-4 py-2">Concepto</th><th className="px-4 py-2">Detalle</th><th className="px-4 py-2">Método</th><th className="px-4 py-2 text-right">Monto</th></tr>
                </thead>
                <tbody>
                  <tr className="border-t border-borde text-tinta-suave"><td className="px-4 py-2 tabular-nums">{horaCorta(s.apertura)}</td><td className="px-4 py-2">Apertura</td><td className="px-4 py-2">{s.caja.nombre}</td><td className="px-4 py-2">Efectivo</td><td className="px-4 py-2 text-right tabular-nums">{soles(s.montoApertura)}</td></tr>
                  {[...s.movimientos].reverse().map((m) => (
                    <tr key={m.id} className="border-t border-borde">
                      <td className="px-4 py-2 tabular-nums">{horaCorta(m.fecha)}</td>
                      <td className="px-4 py-2">{m.concepto}</td>
                      <td className="px-4 py-2 text-tinta-suave">{m.descripcion}</td>
                      <td className="px-4 py-2">{m.metodo}</td>
                      <td className={clsx('px-4 py-2 text-right font-semibold tabular-nums', m.tipo === 'EGRESO' ? 'text-ocupada' : 'text-desocupada')}>{m.tipo === 'EGRESO' ? '−' : '+'} {soles(m.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            {(comprobantes.data?.length ?? 0) > 0 && (
              <Card className="flex flex-col gap-2 p-4">
                <h3 className="font-semibold">Comprobantes de hoy</h3>
                {comprobantes.data!.map((c) => (
                  <button key={c.id} onClick={() => setVerComp(c.id)} className="flex justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-fondo">
                    <span><span className="font-mono">{c.numero}</span> · {c.cliente}</span>
                    <span className="tabular-nums">{c.hora} · <b>{soles(c.total)}</b></span>
                  </button>
                ))}
              </Card>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <Card className="flex flex-col gap-3 p-4">
              <h3 className="font-semibold">Gasto o retiro de efectivo</h3>
              <Selector value={mov.concepto} onChange={(e) => setMov({ ...mov, concepto: e.target.value })} aria-label="Concepto">
                <option value="GASTO">Gasto (compra menor)</option>
                <option value="RETIRO">Retiro (entrega a gerencia)</option>
                <option value="INGRESO_FONDOS">Ingreso de sencillo</option>
              </Selector>
              <div className="grid grid-cols-[100px_1fr] gap-2">
                <Entrada type="number" min={0} step="0.10" placeholder="S/" value={mov.monto} onChange={(e) => setMov({ ...mov, monto: e.target.value })} aria-label="Monto" />
                <Entrada placeholder="Detalle (ej. útiles de limpieza)" value={mov.descripcion} onChange={(e) => setMov({ ...mov, descripcion: e.target.value })} aria-label="Detalle" />
              </div>
              {movimiento.error && <Aviso>{movimiento.error.message}</Aviso>}
              <Button disabled={!(Number(mov.monto) > 0) || mov.descripcion.trim().length < 3 || movimiento.isPending} onClick={() => movimiento.mutate()}>Registrar</Button>
            </Card>
            {puede(sesion, 'caja.cerrar') && (
              <Card className="flex flex-col gap-3 p-4">
                <h3 className="font-semibold">Cerrar caja (arqueo)</h3>
                <p className="text-sm text-tinta-suave">Cuenta el efectivo del cajón y escríbelo. El sistema lo compara con lo que debería haber.</p>
                <Campo etiqueta="Efectivo contado (S/)"><Entrada type="number" min={0} step="0.10" value={contado} onChange={(e) => setContado(e.target.value)} /></Campo>
                {diferencia !== null && (
                  <p className={clsx('text-sm font-medium', Math.abs(diferencia) < 0.005 ? 'text-desocupada' : diferencia < 0 ? 'text-ocupada' : 'text-limpieza')}>
                    {Math.abs(diferencia) < 0.005 ? 'Cuadra exacto.' : diferencia < 0 ? `Faltan ${soles(-diferencia)}.` : `Sobran ${soles(diferencia)}.`}
                  </p>
                )}
                {cerrar.error && <Aviso>{cerrar.error.message}</Aviso>}
                <Button variante="primario" disabled={contado === '' || cerrar.isPending} onClick={() => cerrar.mutate()}>Cerrar caja</Button>
              </Card>
            )}
          </div>
        </div>
      )}

      <PanelLateral titulo="Comprobante" abierto={verComp !== null} onCerrar={() => setVerComp(null)}>
        {verComp !== null && (
          <div className="flex flex-col gap-3">
            <VistaComprobante id={verComp} />
            <Button onClick={() => window.print()}>Imprimir</Button>
          </div>
        )}
      </PanelLateral>
    </div>
  );
}
