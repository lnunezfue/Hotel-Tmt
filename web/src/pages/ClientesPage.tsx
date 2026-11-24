import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type Cliente } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Aviso, Entrada, PanelLateral, Pildora } from '../components/ui/form';
import { FormularioCliente } from '../components/hospedaje/clientes';

/** Cartera de clientes y huéspedes de la empresa (RF-RES-17). */
export function ClientesPage() {
  const [q, setQ] = useState('');
  const [inactivos, setInactivos] = useState(false);
  const [editando, setEditando] = useState<Cliente | 'nuevo' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const termino = q.trim();
  const clientes = useQuery({
    queryKey: ['clientes', 'lista', termino, inactivos],
    queryFn: () => api<Cliente[]>(`/hospedaje/clientes?q=${encodeURIComponent(termino)}&incluirInactivos=${inactivos}`),
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
      {clientes.error && <Aviso>{clientes.error.message}</Aviso>}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-borde bg-fondo text-left text-xs tracking-wide text-tinta-suave uppercase">
            <tr><th className="px-4 py-2">Cliente</th><th className="px-4 py-2">Documento</th><th className="px-4 py-2">Nacionalidad</th><th className="px-4 py-2">Contacto</th><th className="px-4 py-2" /></tr>
          </thead>
          <tbody>
            {clientes.data?.map((c) => (
              <tr key={c.id} className="border-b border-borde last:border-0">
                <td className="px-4 py-2.5">
                  <span className="font-medium">{c.nombreCompleto}</span>
                  {!c.esPersona && <Pildora className="ml-2 bg-acento-suave text-acento">Empresa</Pildora>}
                  {!c.activo && <Pildora className="ml-2 bg-fondo text-tinta-suave">Desactivado</Pildora>}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{c.tipoDocumentoAbrev} {c.numeroDocumento}</td>
                <td className="px-4 py-2.5">{c.pais}</td>
                <td className="px-4 py-2.5 text-tinta-suave">{[c.telefono, c.email].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-4 py-2.5 text-right"><Button variante="fantasma" onClick={() => setEditando(c)}>Editar</Button></td>
              </tr>
            ))}
            {clientes.data?.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-tinta-suave">{termino ? 'Nadie coincide con la búsqueda.' : 'Aún no hay clientes registrados.'}</td></tr>
            )}
          </tbody>
        </table>
        {!termino && clientes.data && clientes.data.length >= 30 && <p className="border-t border-borde px-4 py-2 text-xs text-tinta-suave">Se muestran los 30 más recientes; busca para encontrar a los demás.</p>}
      </Card>

      <PanelLateral titulo={editando === 'nuevo' ? 'Nuevo cliente' : 'Editar cliente'} abierto={editando !== null} onCerrar={() => setEditando(null)}>
        {editando !== null && (
          <FormularioCliente
            key={editando === 'nuevo' ? 'nuevo' : editando.id}
            cliente={editando === 'nuevo' ? undefined : editando}
            onGuardado={(c) => { setEditando(null); setAviso(`${c.nombreCompleto} guardado.`); }}
          />
        )}
      </PanelLateral>
    </div>
  );
}
