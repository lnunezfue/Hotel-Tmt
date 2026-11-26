import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type SerieComprobante } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Aviso, Campo, Entrada, PanelLateral, Pildora, Selector } from '../components/ui/form';

interface Asignable { id: number; username: string; nombre: string; rol: string }
type Tipo = SerieComprobante['tipo'];

const TIPOS: Array<{ id: Tipo; texto: string; ejemplo: string }> = [
  { id: 'BOLETA', texto: 'Boleta', ejemplo: 'B001' },
  { id: 'FACTURA', texto: 'Factura', ejemplo: 'F001' },
  { id: 'INTERNO', texto: 'Nota interna', ejemplo: 'I001' },
  { id: 'NOTA_CREDITO', texto: 'Nota de crédito', ejemplo: 'BC01 o FC01' },
  { id: 'NOTA_DEBITO', texto: 'Nota de débito', ejemplo: 'BD01 o FD01' },
];
const texto = (t: Tipo) => TIPOS.find((x) => x.id === t)?.texto ?? t;
const json = (method: string, cuerpo: unknown) => ({ method, body: JSON.stringify(cuerpo) });

function NuevaSerie({ onListo }: { onListo: (s: SerieComprobante) => void }) {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<Tipo>('BOLETA');
  const [serie, setSerie] = useState('');
  const [inicial, setInicial] = useState('0');
  const crear = useMutation({
    mutationFn: () => api<SerieComprobante>('/facturacion/series', json('POST', { tipo, serie, correlativoInicial: Number(inicial) || 0 })),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ['series'] }); onListo(s); },
  });
  const ej = TIPOS.find((t) => t.id === tipo)!.ejemplo;
  return (
    <div className="flex flex-col gap-4">
      <Campo etiqueta="Tipo de comprobante">
        <Selector value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
          {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.texto}</option>)}
        </Selector>
      </Campo>
      <Campo etiqueta="Serie" ayuda={`4 caracteres con el prefijo de SUNAT, por ejemplo ${ej}.`}>
        <Entrada value={serie} maxLength={4} onChange={(e) => setSerie(e.target.value.toUpperCase())} placeholder={ej.split(' ')[0]} className="font-mono" />
      </Campo>
      <Campo etiqueta="Último número ya emitido" ayuda="0 para empezar en 1. Si vienes de otro sistema, el último número que emitiste con esta serie.">
        <Entrada type="number" min={0} value={inicial} onChange={(e) => setInicial(e.target.value)} />
      </Campo>
      {crear.error && <Aviso>{crear.error.message}</Aviso>}
      <Button variante="primario" disabled={serie.length !== 4 || crear.isPending} onClick={() => crear.mutate()}>Crear serie</Button>
      <p className="text-xs text-tinta-suave">Después de creada, la serie y su número no se cambian: se activa o desactiva.</p>
    </div>
  );
}

function EditarSerie({ s, onListo }: { s: SerieComprobante; onListo: (m: string) => void }) {
  const qc = useQueryClient();
  const usuarios = useQuery({ queryKey: ['series', 'usuarios'], queryFn: () => api<Asignable[]>('/facturacion/series/usuarios') });
  const [elegidos, setElegidos] = useState<number[]>(s.usuarios.map((u) => u.id));
  const refrescar = () => qc.invalidateQueries({ queryKey: ['series'] });
  const asignar = useMutation({
    mutationFn: () => api<SerieComprobante>(`/facturacion/series/${s.id}/usuarios`, json('PUT', { usuarioIds: elegidos })),
    onSuccess: () => { refrescar(); onListo(`Usuarios de ${s.serie} guardados.`); },
  });
  const activar = useMutation({
    mutationFn: () => api<SerieComprobante>(`/facturacion/series/${s.id}`, json('PATCH', { activo: !s.activo })),
    onSuccess: () => { refrescar(); onListo(`Serie ${s.serie} ${s.activo ? 'desactivada' : 'activada'}.`); },
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg bg-fondo p-3 text-sm">
        <div className="font-mono text-lg font-bold">{s.serie}</div>
        <div className="text-tinta-suave">{texto(s.tipo)} · {s.comprobantes} comprobantes · siguiente <span className="font-mono">{s.siguiente}</span></div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs tracking-widest text-tinta-suave uppercase">Usuarios que emiten con esta serie</span>
        <p className="text-xs text-tinta-suave">Sin usuarios, la serie es compartida. Con usuarios, solo ellos la usan y cada caja lleva su propia numeración.</p>
        <div className="flex max-h-64 flex-col overflow-y-auto rounded-lg border border-borde text-sm">
          {usuarios.data?.map((u) => (
            <label key={u.id} className="flex items-center gap-3 border-b border-borde px-3 py-2 last:border-0">
              <input type="checkbox" checked={elegidos.includes(u.id)} onChange={(e) => setElegidos(e.target.checked ? [...elegidos, u.id] : elegidos.filter((x) => x !== u.id))} />
              <span className="flex-1">{u.nombre} <span className="text-xs text-tinta-suave">· {u.username}</span></span>
              <span className="text-xs text-tinta-suave">{u.rol}</span>
            </label>
          ))}
        </div>
        {asignar.error && <Aviso>{asignar.error.message}</Aviso>}
        <Button variante="primario" disabled={asignar.isPending} onClick={() => asignar.mutate()}>Guardar usuarios</Button>
      </div>
      {activar.error && <Aviso>{activar.error.message}</Aviso>}
      <Button disabled={activar.isPending} onClick={() => activar.mutate()}>{s.activo ? 'Desactivar serie' : 'Activar serie'}</Button>
    </div>
  );
}

/** Series de comprobantes de la sucursal y su asignación a usuarios (RF-FAC-01, RF-FAC-02). */
export function SeriesPage() {
  const series = useQuery({ queryKey: ['series'], queryFn: () => api<SerieComprobante[]>('/facturacion/series') });
  const [panel, setPanel] = useState<SerieComprobante | 'nueva' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const actual = panel && panel !== 'nueva' ? series.data?.find((s) => s.id === panel.id) ?? panel : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs text-tinta-suave">Configuración / Series</div>
          <h1 className="text-2xl font-bold">Series de comprobantes</h1>
        </div>
        <Button variante="primario" onClick={() => setPanel('nueva')}>+ Nueva serie</Button>
      </header>
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {series.error && <Aviso>{series.error.message}</Aviso>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-borde bg-fondo text-left text-xs tracking-wide text-tinta-suave uppercase">
            <tr><th className="px-4 py-2">Serie</th><th className="px-4 py-2">Tipo</th><th className="px-4 py-2">Siguiente número</th><th className="px-4 py-2">Usuarios</th><th className="px-4 py-2">Estado</th><th className="px-4 py-2" /></tr>
          </thead>
          <tbody>
            {series.data?.map((s) => (
              <tr key={s.id} className="border-b border-borde last:border-0">
                <td className="px-4 py-2.5 font-mono font-semibold">{s.serie}</td>
                <td className="px-4 py-2.5">{texto(s.tipo)}</td>
                <td className="px-4 py-2.5 font-mono tabular-nums">{s.siguiente}</td>
                <td className="px-4 py-2.5 text-tinta-suave">{s.usuarios.length ? s.usuarios.map((u) => u.username).join(', ') : 'Compartida'}</td>
                <td className="px-4 py-2.5">{s.activo ? <Pildora className="bg-desocupada/10 text-desocupada">Activa</Pildora> : <Pildora className="bg-fondo text-tinta-suave">Inactiva</Pildora>}</td>
                <td className="px-4 py-2.5 text-right"><Button variante="fantasma" onClick={() => setPanel(s)}>Editar</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-tinta-suave">
        Al cobrar, cada usuario emite con su serie asignada; si no tiene una, con una compartida. El número se asigna dentro de la misma
        operación, sin saltos ni duplicados aunque varias cajas cobren a la vez.
      </p>
      <PanelLateral titulo={panel === 'nueva' ? 'Nueva serie' : `Serie ${actual?.serie ?? ''}`} abierto={panel !== null} onCerrar={() => setPanel(null)}>
        {panel === 'nueva' && <NuevaSerie onListo={(s) => { setPanel(null); setAviso(`Serie ${s.serie} creada.`); }} />}
        {actual && <EditarSerie key={actual.id} s={actual} onListo={(m) => { setPanel(null); setAviso(m); }} />}
      </PanelLateral>
    </div>
  );
}
