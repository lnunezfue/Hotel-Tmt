import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, type Cliente, type Pais, type TipoDocumento } from '../../lib/api';
import { ayudaDocumento, errorDocumento, TIPOS_DOCUMENTO } from '../../features/hospedaje/reservas';
import { Button } from '../ui/Button';
import { Aviso, Campo, Entrada, Selector } from '../ui/form';

export function usePaises() {
  return useQuery({ queryKey: ['paises'], queryFn: () => api<Pais[]>('/catalogos/paises'), staleTime: Infinity });
}

/** Alta o edición de un cliente (RF-RES-17). `soloPersonas` oculta el RUC: un huésped debe identificarse. */
export function FormularioCliente({ cliente, soloPersonas, onGuardado, onCancelar }: { cliente?: Cliente; soloPersonas?: boolean; onGuardado: (c: Cliente) => void; onCancelar?: () => void }) {
  const qc = useQueryClient();
  const paises = usePaises();
  const [tipo, setTipo] = useState<TipoDocumento>(cliente?.tipoDocumento ?? '1');
  const [numero, setNumero] = useState(cliente?.numeroDocumento ?? '');
  const [razonSocial, setRazonSocial] = useState(cliente?.razonSocial ?? '');
  const [nombres, setNombres] = useState(cliente?.nombres ?? '');
  const [apellidos, setApellidos] = useState(cliente?.apellidos ?? '');
  const [pais, setPais] = useState(cliente?.paisCodigo ?? 'PE');
  const [telefono, setTelefono] = useState(cliente?.telefono ?? '');
  const [email, setEmail] = useState(cliente?.email ?? '');
  const [nacimiento, setNacimiento] = useState(cliente?.fechaNacimiento ?? '');
  const [sexo, setSexo] = useState(cliente?.sexo ?? '');
  const [direccion, setDireccion] = useState(cliente?.direccion ?? '');
  const empresa = tipo === '6';
  const errorDoc = numero ? errorDocumento(tipo, numero) : null;

  const guardar = useMutation({
    mutationFn: (extra: Record<string, unknown> = {}) => {
      const datos = {
        tipoDocumento: tipo,
        numeroDocumento: numero,
        razonSocial: empresa ? razonSocial : null,
        nombres: empresa ? null : nombres,
        apellidos: empresa ? null : apellidos,
        paisCodigo: pais,
        telefono: telefono || null,
        email: email || null,
        fechaNacimiento: !empresa && nacimiento ? nacimiento : null,
        sexo: !empresa && sexo ? sexo : null,
        direccion: direccion || null,
        ...extra,
      };
      const init = { method: cliente ? 'PATCH' : 'POST', body: JSON.stringify(datos) };
      return api<Cliente>(cliente ? `/hospedaje/clientes/${cliente.id}` : '/hospedaje/clientes', init);
    },
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['clientes'] });
      onGuardado(c);
    },
  });
  const completo = !errorDocumento(tipo, numero) && (empresa ? razonSocial.trim().length >= 2 : nombres.trim() && apellidos.trim());
  const tipos = TIPOS_DOCUMENTO.filter((t) => !soloPersonas || t.persona);

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); guardar.mutate({}); }}>
      <div className="grid grid-cols-[150px_1fr] gap-3">
        <Campo etiqueta="Documento">
          <Selector value={tipo} onChange={(e) => setTipo(e.target.value as TipoDocumento)}>
            {tipos.map((t) => <option key={t.codigo} value={t.codigo}>{t.texto}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Número" ayuda={errorDoc ? <span className="text-red-700">{errorDoc}</span> : ayudaDocumento(tipo)}>
          <Entrada value={numero} onChange={(e) => setNumero(e.target.value)} autoFocus={!cliente} required aria-invalid={Boolean(errorDoc)} />
        </Campo>
      </div>
      {empresa ? (
        <Campo etiqueta="Razón social"><Entrada value={razonSocial} maxLength={200} onChange={(e) => setRazonSocial(e.target.value)} required /></Campo>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Nombres"><Entrada value={nombres} maxLength={100} onChange={(e) => setNombres(e.target.value)} required /></Campo>
          <Campo etiqueta="Apellidos"><Entrada value={apellidos} maxLength={100} onChange={(e) => setApellidos(e.target.value)} required /></Campo>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta={empresa ? 'País' : 'Nacionalidad'}>
          <Selector value={pais} onChange={(e) => setPais(e.target.value)}>
            {(paises.data ?? [{ codigo: 'PE', nombre: 'Perú' }]).map((p) => <option key={p.codigo} value={p.codigo}>{p.nombre}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Teléfono"><Entrada value={telefono} maxLength={20} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" /></Campo>
      </div>
      {!empresa && (
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Fecha de nacimiento"><Entrada type="date" value={nacimiento} onChange={(e) => setNacimiento(e.target.value)} /></Campo>
          <Campo etiqueta="Sexo">
            <Selector value={sexo} onChange={(e) => setSexo(e.target.value as typeof sexo)}>
              <option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="X">Otro</option>
            </Selector>
          </Campo>
        </div>
      )}
      <Campo etiqueta="Correo"><Entrada type="email" value={email} maxLength={120} onChange={(e) => setEmail(e.target.value)} /></Campo>
      <Campo etiqueta="Dirección"><Entrada value={direccion} maxLength={250} onChange={(e) => setDireccion(e.target.value)} /></Campo>
      {guardar.error && <Aviso>{guardar.error.message}</Aviso>}
      <div className="flex gap-2">
        <Button variante="primario" type="submit" disabled={!completo || guardar.isPending}>{cliente ? 'Guardar' : 'Registrar cliente'}</Button>
        {onCancelar && <Button type="button" variante="fantasma" onClick={onCancelar}>Cancelar</Button>}
      </div>
      {cliente && (
        <Button type="button" disabled={guardar.isPending} onClick={() => guardar.mutate({ activo: !cliente.activo })}>
          {cliente.activo ? 'Desactivar cliente' : 'Activar cliente'}
        </Button>
      )}
    </form>
  );
}

/** Busca un cliente por documento o nombre; si no existe, lo registra ahí mismo. */
export function BuscadorCliente({ etiqueta, soloPersonas, excluir = [], onElegir }: { etiqueta: string; soloPersonas?: boolean; excluir?: number[]; onElegir: (c: Cliente) => void }) {
  const [q, setQ] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const termino = q.trim();
  const resultados = useQuery({
    queryKey: ['clientes', 'buscar', termino],
    queryFn: () => api<Cliente[]>(`/hospedaje/clientes?q=${encodeURIComponent(termino)}`),
    enabled: termino.length >= 2,
  });
  const lista = (resultados.data ?? []).filter((c) => !excluir.includes(c.id));

  if (nuevo) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-borde p-3">
        <span className="text-sm font-semibold">Nuevo cliente</span>
        <FormularioCliente soloPersonas={soloPersonas} onGuardado={(c) => { setNuevo(false); setQ(''); onElegir(c); }} onCancelar={() => setNuevo(false)} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Campo etiqueta={etiqueta}>
        <Entrada value={q} onChange={(e) => setQ(e.target.value)} placeholder="Documento o nombre" />
      </Campo>
      {termino.length >= 2 && (
        <ul className="flex max-h-56 flex-col overflow-y-auto rounded-lg border border-borde text-sm">
          {resultados.isLoading && <li className="px-3 py-2 text-tinta-suave">Buscando…</li>}
          {lista.map((c) => {
            const vetado = soloPersonas && !c.esPersona;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={vetado}
                  onClick={() => { setQ(''); onElegir(c); }}
                  className={clsx('flex w-full flex-col items-start border-b border-borde px-3 py-2 text-left last:border-0', vetado ? 'cursor-not-allowed opacity-50' : 'hover:bg-fondo')}
                  title={vetado ? 'Una empresa no puede alojarse' : undefined}
                >
                  <span className="font-medium">{c.nombreCompleto}</span>
                  <span className="text-xs text-tinta-suave">{c.tipoDocumentoAbrev} {c.numeroDocumento} · {c.pais}</span>
                </button>
              </li>
            );
          })}
          {resultados.data && lista.length === 0 && <li className="px-3 py-2 text-tinta-suave">Sin resultados.</li>}
        </ul>
      )}
      <button type="button" className="self-start text-sm font-medium text-acento hover:underline" onClick={() => setNuevo(true)}>+ Registrar cliente nuevo</button>
    </div>
  );
}
