import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Cliente, type ClienteDetalle } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Aviso, Campo, Entrada, PanelLateral, Pildora, Selector } from '../components/ui/form';

interface TipoDoc { id: number; abreviatura: string; descripcion: string }
interface Pais { codigo: string; nombre: string }
type FilaCartera = Cliente & { email: string | null; activo: boolean };

/** Alta o edición de un cliente (RF-RES-17). El documento de un cliente con historia no se cambia: lo dice la API. */
function FichaCliente({ id, onListo }: { id: number | null; onListo: (msg: string) => void }) {
  const qc = useQueryClient();
  const tipos = useQuery({ queryKey: ['tipos-documento'], queryFn: () => api<TipoDoc[]>('/clientes/tipos-documento') });
  const paises = useQuery({ queryKey: ['paises'], queryFn: () => api<Pais[]>('/catalogos/paises'), staleTime: Infinity });
  const ficha = useQuery({ queryKey: ['clientes', 'ficha', id], queryFn: () => api<ClienteDetalle>(`/clientes/${id}`), enabled: id !== null });
  const c = ficha.data;
  const [d, setD] = useState<Record<string, string>>({});
  const v = (k: string, previo: string | null | undefined, porDefecto = '') => d[k] ?? previo ?? porDefecto;
  const poner = (k: string) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const tipoId = Number(v('tipoDocumentoId', c ? String(c.tipoDocumentoId) : undefined, String(tipos.data?.find((t) => t.abreviatura === 'DNI')?.id ?? '')));
  const tipo = tipos.data?.find((t) => t.id === tipoId);
  const numero = v('numeroDocumento', c?.numeroDocumento);
  const empresa = tipo?.abreviatura === 'RUC' && numero.startsWith('20');

  const guardar = useMutation({
    mutationFn: (extra: Record<string, unknown> = {}) => {
      const base = {
        tipoDocumentoId: tipoId,
        numeroDocumento: numero,
        nombres: empresa ? null : v('nombres', c?.nombres) || null,
        apellidos: empresa ? null : v('apellidos', c?.apellidos) || null,
        razonSocial: empresa ? v('razonSocial', c?.razonSocial) || null : null,
        pais: v('pais', c?.pais, 'PE'),
        telefono: v('telefono', c?.telefono) || null,
        email: v('email', c?.email) || null,
      };
      if (id === null) return api<Cliente>('/clientes', { method: 'POST', body: JSON.stringify(base) });
      const resto = {
        direccion: v('direccion', c?.direccion) || null,
        fechaNacimiento: empresa ? null : v('fechaNacimiento', c?.fechaNacimiento) || null,
        sexo: empresa ? null : (v('sexo', c?.sexo) || null) as 'M' | 'F' | 'X' | null,
        observaciones: v('observaciones', c?.observaciones) || null,
      };
      return api<Cliente>(`/clientes/${id}`, { method: 'PATCH', body: JSON.stringify({ ...base, ...resto, ...extra }) });
    },
    onSuccess: (r, extra) => {
      qc.invalidateQueries({ queryKey: ['clientes'] });
      onListo('activo' in (extra ?? {}) ? `${r.nombre} ${(extra as { activo: boolean }).activo ? 'activado' : 'desactivado'}.` : `${r.nombre} guardado.`);
    },
  });

  if (id !== null && !c) return <p className="text-sm text-tinta-suave">{ficha.error ? ficha.error.message : 'Cargando…'}</p>;
  const completo = numero.trim() && (empresa ? v('razonSocial', c?.razonSocial).trim() : v('nombres', c?.nombres).trim() && v('apellidos', c?.apellidos).trim());

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[120px_1fr] gap-3">
        <Campo etiqueta="Documento">
          <Selector value={tipoId || ''} onChange={poner('tipoDocumentoId')}>
            {tipos.data?.map((t) => <option key={t.id} value={t.id}>{t.abreviatura}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Número" ayuda={tipo?.abreviatura === 'DNI' ? '8 dígitos' : tipo?.abreviatura === 'RUC' ? '11 dígitos con dígito verificador' : 'De 4 a 15 letras o números'}>
          <Entrada value={numero} maxLength={15} onChange={poner('numeroDocumento')} autoFocus={id === null} />
        </Campo>
      </div>
      {empresa ? (
        <Campo etiqueta="Razón social"><Entrada value={v('razonSocial', c?.razonSocial)} maxLength={200} onChange={poner('razonSocial')} /></Campo>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Nombres"><Entrada value={v('nombres', c?.nombres)} maxLength={100} onChange={poner('nombres')} /></Campo>
          <Campo etiqueta="Apellidos"><Entrada value={v('apellidos', c?.apellidos)} maxLength={100} onChange={poner('apellidos')} /></Campo>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta={empresa ? 'País' : 'Nacionalidad'}>
          <Selector value={v('pais', c?.pais, 'PE')} onChange={poner('pais')}>
            {(paises.data ?? [{ codigo: 'PE', nombre: 'Perú' }]).map((x) => <option key={x.codigo} value={x.codigo}>{x.nombre}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Teléfono"><Entrada value={v('telefono', c?.telefono)} maxLength={20} onChange={poner('telefono')} inputMode="tel" /></Campo>
      </div>
      <Campo etiqueta="Correo"><Entrada type="email" value={v('email', c?.email)} maxLength={120} onChange={poner('email')} /></Campo>
      {id !== null && (
        <>
          {!empresa && (
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Fecha de nacimiento"><Entrada type="date" value={v('fechaNacimiento', c?.fechaNacimiento)} onChange={poner('fechaNacimiento')} /></Campo>
              <Campo etiqueta="Sexo">
                <Selector value={v('sexo', c?.sexo)} onChange={poner('sexo')}>
                  <option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="X">Otro</option>
                </Selector>
              </Campo>
            </div>
          )}
          <Campo etiqueta="Dirección"><Entrada value={v('direccion', c?.direccion)} maxLength={250} onChange={poner('direccion')} /></Campo>
          <Campo etiqueta="Observaciones"><Entrada value={v('observaciones', c?.observaciones)} maxLength={500} onChange={poner('observaciones')} /></Campo>
        </>
      )}
      {guardar.error && <Aviso>{guardar.error.message}</Aviso>}
      <Button variante="primario" disabled={!completo || guardar.isPending} onClick={() => guardar.mutate({})}>{id === null ? 'Registrar cliente' : 'Guardar'}</Button>
      {c && (
        <Button disabled={guardar.isPending} onClick={() => guardar.mutate({ activo: !c.activo })}>{c.activo ? 'Desactivar cliente' : 'Activar cliente'}</Button>
      )}
      {c && <p className="text-xs text-tinta-suave">Si el cliente ya tiene reservas, estadías o comprobantes, su documento no se cambia: registra un cliente nuevo.</p>}
    </div>
  );
}

/** Cartera de clientes y huéspedes de la empresa (RF-RES-17). */
export function ClientesPage() {
  const [q, setQ] = useState('');
  const [inactivos, setInactivos] = useState(false);
  const [editando, setEditando] = useState<number | 'nuevo' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const t = q.trim();
  const lista = useQuery({
    queryKey: ['clientes', 'cartera', t, inactivos],
    queryFn: () => api<FilaCartera[]>(`/clientes/cartera?q=${encodeURIComponent(t)}&incluirInactivos=${inactivos}`),
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs text-tinta-suave">Hotel / Clientes</div>
          <h1 className="text-2xl font-bold">Clientes y huéspedes</h1>
        </div>
        <Button variante="primario" onClick={() => setEditando('nuevo')}>+ Nuevo cliente</Button>
      </header>
      <div className="flex flex-wrap items-center gap-4">
        <Entrada className="max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por documento o nombre" aria-label="Buscar cliente" />
        <label className="flex items-center gap-2 text-sm text-tinta-suave">
          <input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} /> Incluir desactivados
        </label>
      </div>
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {lista.error && <Aviso>{lista.error.message}</Aviso>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-borde bg-fondo text-left text-xs tracking-wide text-tinta-suave uppercase">
            <tr><th className="px-4 py-2">Cliente</th><th className="px-4 py-2">Documento</th><th className="px-4 py-2">País</th><th className="px-4 py-2">Contacto</th><th className="px-4 py-2" /></tr>
          </thead>
          <tbody>
            {lista.data?.map((c) => (
              <tr key={c.id} className="border-b border-borde last:border-0">
                <td className="px-4 py-2.5">
                  <span className="font-medium">{c.nombre}</span>
                  {/^RUC 20/.test(c.documento) && <Pildora className="ml-2 bg-acento-suave text-acento">Empresa</Pildora>}
                  {!c.activo && <Pildora className="ml-2 bg-fondo text-tinta-suave">Desactivado</Pildora>}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{c.documento}</td>
                <td className="px-4 py-2.5">{c.pais}</td>
                <td className="px-4 py-2.5 text-tinta-suave">{[c.telefono, c.email].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-4 py-2.5 text-right"><Button variante="fantasma" onClick={() => setEditando(c.id)}>Editar</Button></td>
              </tr>
            ))}
            {lista.data?.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-tinta-suave">{t ? 'Nadie coincide con la búsqueda.' : 'Aún no hay clientes.'}</td></tr>}
          </tbody>
        </table>
        {!t && lista.data && lista.data.length >= 50 && <p className="border-t border-borde px-4 py-2 text-xs text-tinta-suave">Se muestran los 50 más recientes; busca para encontrar a los demás.</p>}
      </Card>
      <PanelLateral titulo={editando === 'nuevo' ? 'Nuevo cliente' : 'Editar cliente'} abierto={editando !== null} onCerrar={() => setEditando(null)}>
        {editando !== null && (
          <FichaCliente key={String(editando)} id={editando === 'nuevo' ? null : editando} onListo={(m) => { setEditando(null); setAviso(m); }} />
        )}
      </PanelLateral>
    </div>
  );
}
