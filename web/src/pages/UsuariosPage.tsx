import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import { puede, useSesion } from '../features/auth/sesion';
import { generarClaveTemporal, problemasClave } from '../features/organizacion/clave';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Aviso, Campo, Entrada, PanelLateral, Pestanas, Pildora, Selector } from '../components/ui/form';

type EstadoUsuario = 'ACTIVO' | 'BLOQUEADO' | 'INACTIVO';
interface Usuario {
  id: number; username: string; nombres: string; apellidos: string; nombre: string; email: string | null;
  rolId: number; rol: string; estado: EstadoUsuario; debeCambiarClave: boolean; ultimoAcceso: string | null;
  sesionesActivas: number; sucursales: Array<{ id: number; nombre: string; principal: boolean }>;
}
interface Rol { id: number; nombre: string; descripcion: string | null; editable: boolean; usuarios: number; permisos: string[] }
interface Permiso { codigo: string; modulo: string; descripcion: string | null }
interface Sucursal { id: number; nombre: string; tipo: string }
interface Resultado { sesionesCerradas?: number }

const PILL: Record<EstadoUsuario, string> = { ACTIVO: 'bg-desocupada/10 text-desocupada', BLOQUEADO: 'bg-ocupada/10 text-ocupada', INACTIVO: 'bg-limpieza/15 text-limpieza' };
const post = <T,>(ruta: string, cuerpo?: unknown) => api<T>(ruta, { method: 'POST', body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
const sesionesTexto = (n?: number) => (n ? ` Se cerraron ${n} ${n === 1 ? 'sesión abierta' : 'sesiones abiertas'}.` : '');

// ── Formulario de alta / edición ────────────────────────────────

function FormularioUsuario({ usuario, roles, sucursales, onListo }: { usuario: Usuario | null; roles: Rol[]; sucursales: Sucursal[]; onListo: (msg: string) => void }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState(usuario?.username ?? '');
  const [nombres, setNombres] = useState(usuario?.nombres ?? '');
  const [apellidos, setApellidos] = useState(usuario?.apellidos ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [rolId, setRolId] = useState<number>(usuario?.rolId ?? roles.find((r) => r.nombre === 'RECEPCIONISTA')?.id ?? roles[0]?.id);
  const [asignadas, setAsignadas] = useState<number[]>(usuario?.sucursales.map((s) => s.id) ?? (sucursales[0] ? [sucursales[0].id] : []));
  const [principal, setPrincipal] = useState<number | undefined>(usuario?.sucursales.find((s) => s.principal)?.id ?? sucursales[0]?.id);
  const [clave, setClave] = useState(() => (usuario ? '' : generarClaveTemporal()));

  const guardar = useMutation({
    mutationFn: () => {
      const datos = { nombres, apellidos, email: email || null, rolId, sucursales: asignadas.map((id) => ({ id, principal: id === principal })) };
      return usuario
        ? api<Usuario & Resultado>(`/organizacion/usuarios/${usuario.id}`, { method: 'PATCH', body: JSON.stringify(datos) })
        : post<Usuario>('/organizacion/usuarios', { ...datos, username, clave });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['usuarios'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
      onListo(usuario ? `Cambios guardados para ${r.username}.${sesionesTexto((r as Resultado).sesionesCerradas)}` : `Usuario ${r.username} creado. Entrégale su contraseña temporal: ${clave}`);
    },
  });

  function alternar(id: number) {
    const nuevas = asignadas.includes(id) ? asignadas.filter((x) => x !== id) : [...asignadas, id];
    setAsignadas(nuevas);
    if (!nuevas.includes(principal ?? -1)) setPrincipal(nuevas[0]);
  }

  const faltanClave = usuario ? [] : problemasClave(clave, username);
  const valido = nombres.trim() && apellidos.trim() && asignadas.length > 0 && principal && (usuario || (username.trim().length >= 3 && faltanClave.length === 0));
  const cambiaAcceso = usuario && (rolId !== usuario.rolId || asignadas.slice().sort().join() !== usuario.sucursales.map((s) => s.id).sort().join() || principal !== usuario.sucursales.find((s) => s.principal)?.id);

  return (
    <form className="flex flex-col gap-4" onSubmit={(e: FormEvent) => { e.preventDefault(); if (valido) guardar.mutate(); }}>
      <Campo etiqueta="Usuario" ayuda={usuario ? 'El nombre de usuario no se cambia' : 'Minúsculas, sin espacios. Ej.: recepcion3'}>
        <Entrada value={username} disabled={!!usuario} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} autoFocus={!usuario} required />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Nombres"><Entrada value={nombres} onChange={(e) => setNombres(e.target.value)} required /></Campo>
        <Campo etiqueta="Apellidos"><Entrada value={apellidos} onChange={(e) => setApellidos(e.target.value)} required /></Campo>
      </div>
      <Campo etiqueta="Correo (opcional)"><Entrada type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
      <Campo etiqueta="Rol">
        <Selector value={rolId} onChange={(e) => setRolId(Number(e.target.value))}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
        </Selector>
      </Campo>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Sucursales</legend>
        {sucursales.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-lg border border-borde px-3 py-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={asignadas.includes(s.id)} onChange={() => alternar(s.id)} /> {s.nombre}</label>
            <label className={clsx('flex items-center gap-1.5 text-xs', !asignadas.includes(s.id) && 'opacity-40')}>
              <input type="radio" name="principal" disabled={!asignadas.includes(s.id)} checked={principal === s.id} onChange={() => setPrincipal(s.id)} /> principal
            </label>
          </div>
        ))}
        <span className="text-xs text-tinta-suave">La principal es la que se abre al ingresar.</span>
      </fieldset>
      {!usuario && (
        <Campo etiqueta="Contraseña temporal" ayuda={faltanClave.length ? `Falta: ${faltanClave.join(', ')}` : 'Deberá cambiarla en su primer ingreso'}>
          <div className="flex gap-2">
            <Entrada value={clave} onChange={(e) => setClave(e.target.value)} className="font-mono" />
            <Button type="button" onClick={() => setClave(generarClaveTemporal())}>Generar</Button>
          </div>
        </Campo>
      )}
      {cambiaAcceso && <Aviso tipo="info">Cambiar el rol o las sucursales cierra las sesiones abiertas de este usuario.</Aviso>}
      {guardar.error && <Aviso>{guardar.error.message}</Aviso>}
      <Button variante="primario" type="submit" disabled={!valido || guardar.isPending}>{guardar.isPending ? 'Guardando…' : usuario ? 'Guardar cambios' : 'Crear usuario'}</Button>
    </form>
  );
}

/** Menú de acciones secundarias de una fila (se cierra al elegir o al hacer clic fuera). */
function MenuAcciones({ opciones }: { opciones: Array<{ texto: string; peligro?: boolean; alElegir: () => void }> }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setAbierto(false); }}>
      <Button variante="fantasma" className="h-8 w-8 px-0" aria-label="Más acciones" aria-expanded={abierto} onClick={() => setAbierto(!abierto)}>⋯</Button>
      {abierto && (
        <div role="menu" className="absolute right-0 z-30 mt-1 flex w-56 flex-col rounded-lg border border-borde bg-white py-1 shadow-lg">
          {opciones.map((o) => (
            <button key={o.texto} role="menuitem" className={clsx('px-3 py-2 text-left text-sm hover:bg-fondo', o.peligro && 'text-ocupada')} onClick={() => { setAbierto(false); o.alElegir(); }}>
              {o.texto}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pestaña de usuarios ─────────────────────────────────────────

function TablaUsuarios({ gestiona, miId }: { gestiona: boolean; miId?: number }) {
  const qc = useQueryClient();
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => api<Usuario[]>('/organizacion/usuarios') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Rol[]>('/organizacion/roles') });
  const sucursales = useQuery({ queryKey: ['sucursales-todas'], queryFn: () => api<Sucursal[]>('/organizacion/sucursales/todas') });
  const [buscar, setBuscar] = useState('');
  const [filtro, setFiltro] = useState<EstadoUsuario | ''>('');
  const [editando, setEditando] = useState<Usuario | 'nuevo' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<{ usuario: Usuario; accion: 'desactivar' | 'restablecer' | 'cerrar' } | null>(null);
  const [claveNueva, setClaveNueva] = useState('');

  const accion = useMutation({
    mutationFn: ({ u, ruta, cuerpo }: { u: Usuario; ruta: string; cuerpo?: unknown }) => post<Resultado & Partial<Usuario>>(`/organizacion/usuarios/${u.id}/${ruta}`, cuerpo),
    onSuccess: (r, { u, ruta }) => {
      qc.invalidateQueries({ queryKey: ['usuarios'] });
      const textos: Record<string, string> = {
        desactivar: `${u.username} quedó inactivo.`,
        activar: `${u.username} está activo otra vez.`,
        desbloquear: `${u.username} ya puede ingresar.`,
        'restablecer-clave': `Contraseña temporal de ${u.username}: ${claveNueva}. Deberá cambiarla al ingresar.`,
        'cerrar-sesiones': `Sesiones de ${u.username} cerradas.`,
      };
      setAviso(textos[ruta] + sesionesTexto(r.sesionesCerradas));
      setConfirmar(null);
    },
  });

  const filas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (usuarios.data ?? []).filter((u) => (!filtro || u.estado === filtro) && (!q || `${u.nombre} ${u.username} ${u.rol}`.toLowerCase().includes(q)));
  }, [usuarios.data, buscar, filtro]);
  const cuenta = (e: EstadoUsuario) => usuarios.data?.filter((u) => u.estado === e).length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Entrada placeholder="Buscar por nombre, usuario o rol" value={buscar} onChange={(e) => setBuscar(e.target.value)} className="max-w-xs" aria-label="Buscar usuarios" />
        <div className="flex gap-1" role="group" aria-label="Filtrar por estado">
          {(['', 'ACTIVO', 'BLOQUEADO', 'INACTIVO'] as const).map((e) => (
            <Button key={e || 'todos'} variante={filtro === e ? 'primario' : 'secundario'} onClick={() => setFiltro(e)}>
              {e ? `${e.toLowerCase()} · ${cuenta(e)}` : `Todos · ${usuarios.data?.length ?? 0}`}
            </Button>
          ))}
        </div>
        {gestiona && <Button variante="primario" className="ml-auto" onClick={() => { setAviso(null); setEditando('nuevo'); }}>+ Nuevo usuario</Button>}
      </div>
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {usuarios.error && <Aviso>{usuarios.error.message}</Aviso>}
      {accion.error && <Aviso>{accion.error.message}</Aviso>}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-fondo text-left text-xs tracking-wide text-tinta-suave uppercase">
            <tr><th className="px-4 py-3">Usuario</th><th className="px-4 py-3">Rol</th><th className="px-4 py-3">Sucursales</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Último acceso</th>{gestiona && <th className="px-4 py-3 text-right">Acciones</th>}</tr>
          </thead>
          <tbody>
            {filas.map((u) => (
              <tr key={u.id} className={clsx('border-t border-borde', u.estado === 'INACTIVO' && 'text-tinta-suave')}>
                <td className="px-4 py-3"><div className="font-semibold">{u.nombre}{u.id === miId && <span className="ml-1.5 text-xs font-normal text-tinta-suave">(tú)</span>}</div><div className="font-mono text-xs text-tinta-suave">{u.username}</div></td>
                <td className="px-4 py-3 text-xs font-semibold tracking-wide">{u.rol}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.sucursales.map((s) => <span key={s.id} className={clsx('rounded-md border px-2 py-0.5 text-xs', s.principal ? 'border-acento text-acento' : 'border-borde')} title={s.principal ? 'Principal' : undefined}>{s.nombre}</span>)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <Pildora className={PILL[u.estado]}>{u.estado.toLowerCase()}</Pildora>
                    {u.debeCambiarClave && u.estado !== 'INACTIVO' && <Pildora className="bg-acento-suave text-acento">clave temporal</Pildora>}
                  </div>
                  {u.sesionesActivas > 0 && <div className="mt-1 text-xs text-tinta-suave">{u.sesionesActivas} {u.sesionesActivas === 1 ? 'sesión abierta' : 'sesiones abiertas'}</div>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-tinta-suave tabular-nums">{u.ultimoAcceso ? new Date(u.ultimoAcceso).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca'}</td>
                {gestiona && (
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variante="secundario" className="h-8 px-3" onClick={() => { setAviso(null); setEditando(u); }}>Editar</Button>
                      {u.estado === 'BLOQUEADO' && <Button variante="secundario" className="h-8 px-3 text-acento" onClick={() => accion.mutate({ u, ruta: 'desbloquear' })}>Desbloquear</Button>}
                      {u.estado === 'INACTIVO' && u.id !== miId && <Button variante="secundario" className="h-8 px-3 text-desocupada" onClick={() => accion.mutate({ u, ruta: 'activar' })}>Activar</Button>}
                      {u.id !== miId && u.estado !== 'INACTIVO' && (
                        <MenuAcciones
                          opciones={[
                            { texto: 'Restablecer contraseña', alElegir: () => { setClaveNueva(generarClaveTemporal()); setConfirmar({ usuario: u, accion: 'restablecer' }); } },
                            ...(u.sesionesActivas > 0 ? [{ texto: `Cerrar sesiones (${u.sesionesActivas})`, alElegir: () => setConfirmar({ usuario: u, accion: 'cerrar' }) }] : []),
                            { texto: 'Desactivar', peligro: true, alElegir: () => setConfirmar({ usuario: u, accion: 'desactivar' }) },
                          ]}
                        />
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {usuarios.data && filas.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-tinta-suave">Ningún usuario coincide con el filtro.</td></tr>}
          </tbody>
        </table>
      </Card>

      <PanelLateral titulo={editando === 'nuevo' ? 'Nuevo usuario' : `Editar ${editando?.username ?? ''}`} abierto={editando !== null} onCerrar={() => setEditando(null)}>
        {editando !== null && roles.data && sucursales.data && (
          <FormularioUsuario
            key={editando === 'nuevo' ? 'nuevo' : editando.id}
            usuario={editando === 'nuevo' ? null : editando}
            roles={roles.data}
            sucursales={sucursales.data}
            onListo={(m) => { setAviso(m); setEditando(null); }}
          />
        )}
      </PanelLateral>

      {confirmar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-tinta/30 p-4" onClick={() => setConfirmar(null)}>
          <Card className="flex w-full max-w-sm flex-col gap-4 p-5" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {confirmar.accion === 'desactivar' && <><h3 className="font-semibold">¿Desactivar a {confirmar.usuario.nombre}?</h3><p className="text-sm text-tinta-suave">No podrá ingresar y se cerrarán sus sesiones abiertas. Sus registros (reservas, comprobantes) se conservan.</p></>}
            {confirmar.accion === 'cerrar' && <><h3 className="font-semibold">¿Cerrar las sesiones de {confirmar.usuario.nombre}?</h3><p className="text-sm text-tinta-suave">Tendrá que volver a ingresar en todos sus equipos.</p></>}
            {confirmar.accion === 'restablecer' && (
              <>
                <h3 className="font-semibold">Restablecer la contraseña de {confirmar.usuario.nombre}</h3>
                <Campo etiqueta="Contraseña temporal" ayuda="Se cerrarán sus sesiones; al ingresar deberá crear una nueva.">
                  <Entrada value={claveNueva} onChange={(e) => setClaveNueva(e.target.value)} className="font-mono" />
                </Campo>
              </>
            )}
            {accion.error && <Aviso>{accion.error.message}</Aviso>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setConfirmar(null)}>Cancelar</Button>
              <Button
                variante="primario"
                disabled={accion.isPending || (confirmar.accion === 'restablecer' && problemasClave(claveNueva, confirmar.usuario.username).length > 0)}
                onClick={() => {
                  const u = confirmar.usuario;
                  if (confirmar.accion === 'desactivar') accion.mutate({ u, ruta: 'desactivar' });
                  if (confirmar.accion === 'cerrar') accion.mutate({ u, ruta: 'cerrar-sesiones' });
                  if (confirmar.accion === 'restablecer') accion.mutate({ u, ruta: 'restablecer-clave', cuerpo: { clave: claveNueva } });
                }}
              >
                Confirmar
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Pestaña de roles ────────────────────────────────────────────

function MatrizRoles({ gestiona }: { gestiona: boolean }) {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Rol[]>('/organizacion/roles') });
  const permisos = useQuery({ queryKey: ['permisos'], queryFn: () => api<Permiso[]>('/organizacion/permisos') });
  const [selId, setSelId] = useState<number | null>(null);
  const [marcados, setMarcados] = useState<Set<string> | null>(null);
  const [nuevoRol, setNuevoRol] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const sel = roles.data?.find((r) => r.id === selId) ?? roles.data?.[0];
  const actuales = marcados ?? new Set(sel?.permisos ?? []);
  const modulos = useMemo(() => {
    const m = new Map<string, Permiso[]>();
    for (const p of permisos.data ?? []) m.set(p.modulo, [...(m.get(p.modulo) ?? []), p]);
    return [...m.entries()];
  }, [permisos.data]);
  const sucio = marcados !== null && [...marcados].sort().join() !== (sel?.permisos ?? []).join();
  const editable = gestiona && !!sel?.editable;

  const guardar = useMutation({
    mutationFn: () => api(`/organizacion/roles/${sel!.id}/permisos`, { method: 'PUT', body: JSON.stringify({ permisos: [...actuales] }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['roles'] }); setMarcados(null); setAviso(`Permisos de ${sel!.nombre} guardados. Se aplican a sus usuarios en su próxima renovación de sesión (máx. 15 min).`); },
  });
  const crear = useMutation({
    mutationFn: () => post<{ id: number }>('/organizacion/roles', { nombre: nuevoRol, permisos: [] }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['roles'] }); setNuevoRol(''); setSelId(r.id); setMarcados(null); setAviso('Rol creado. Marca sus permisos y guarda.'); },
  });

  function elegir(id: number) {
    setSelId(id);
    setMarcados(null);
    setAviso(null);
  }
  function alternar(codigo: string) {
    const s = new Set(actuales);
    if (s.has(codigo)) s.delete(codigo); else s.add(codigo);
    setMarcados(s);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <div className="flex flex-col gap-2">
        {roles.data?.map((r) => (
          <button key={r.id} onClick={() => elegir(r.id)} className={clsx('flex flex-col rounded-xl border px-4 py-3 text-left', r.id === sel?.id ? 'border-acento bg-acento-suave/50' : 'border-borde bg-white hover:bg-fondo')}>
            <span className="text-sm font-semibold tracking-wide">{r.nombre}</span>
            <span className="text-xs text-tinta-suave">{r.permisos.length} {r.permisos.length === 1 ? 'permiso' : 'permisos'} · {r.usuarios} {r.usuarios === 1 ? 'usuario' : 'usuarios'}</span>
          </button>
        ))}
        {gestiona && (
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (nuevoRol.trim().length >= 3) crear.mutate(); }}>
            <Entrada placeholder="Nuevo rol, ej. NOCTURNO" value={nuevoRol} onChange={(e) => setNuevoRol(e.target.value.toUpperCase())} aria-label="Nombre del nuevo rol" />
            <Button type="submit" disabled={nuevoRol.trim().length < 3 || crear.isPending}>Crear</Button>
          </form>
        )}
        {crear.error && <Aviso>{crear.error.message}</Aviso>}
      </div>

      {sel && (
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-wide">{sel.nombre}</h2>
              <p className="text-sm text-tinta-suave">{sel.descripcion ?? 'Sin descripción'}</p>
            </div>
            {editable && <Button variante="primario" disabled={!sucio || guardar.isPending} onClick={() => guardar.mutate()}>{guardar.isPending ? 'Guardando…' : 'Guardar permisos'}</Button>}
          </div>
          {!sel.editable && <Aviso tipo="info">El rol ADMINISTRADOR tiene todos los permisos y no se edita, para que la empresa nunca se quede sin administrador.</Aviso>}
          {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
          {guardar.error && <Aviso>{guardar.error.message}</Aviso>}
          <div className="grid gap-4 md:grid-cols-2">
            {modulos.map(([modulo, lista]) => (
              <fieldset key={modulo} className="flex flex-col gap-1.5 rounded-lg border border-borde p-3" disabled={!editable}>
                <legend className="px-1 text-xs font-semibold tracking-widest text-tinta-suave uppercase">{modulo}</legend>
                {lista.map((p) => (
                  <label key={p.codigo} className={clsx('flex items-start gap-2 text-sm', !editable && 'opacity-80')}>
                    <input type="checkbox" className="mt-0.5" checked={actuales.has(p.codigo)} onChange={() => alternar(p.codigo)} />
                    <span><span className="font-mono text-xs">{p.codigo}</span><br /><span className="text-xs text-tinta-suave">{p.descripcion}</span></span>
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export function UsuariosPage() {
  const { data: sesion } = useSesion();
  const gestiona = puede(sesion, 'usuario.gestionar');
  const [pestana, setPestana] = useState<'usuarios' | 'roles'>('usuarios');
  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="text-xs text-tinta-suave">Configuración / Usuarios y roles</div>
        <h1 className="text-2xl font-bold">Usuarios y roles</h1>
        {!gestiona && <p className="text-sm text-tinta-suave">Tu rol solo puede consultar. Para crear o editar se necesita el permiso «usuario.gestionar».</p>}
      </header>
      <Pestanas opciones={[{ id: 'usuarios', texto: 'Usuarios' }, { id: 'roles', texto: 'Roles y permisos' }]} valor={pestana} onCambio={setPestana} />
      {pestana === 'usuarios' ? <TablaUsuarios gestiona={gestiona} miId={sesion?.sub} /> : <MatrizRoles gestiona={gestiona} />}
    </div>
  );
}
