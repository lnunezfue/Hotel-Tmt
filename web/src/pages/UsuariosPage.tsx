import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';

interface FilaUsuario {
  id: number; username: string; nombre: string; email: string | null; rol: string;
  estado: 'ACTIVO' | 'BLOQUEADO' | 'INACTIVO'; ultimoAcceso: string | null;
  sucursales: Array<{ id: number; nombre: string; principal: boolean }>;
}
interface Rol { id: number; nombre: string; descripcion: string | null; permisos: string[] }

const PILL = { ACTIVO: 'bg-desocupada/10 text-desocupada', BLOQUEADO: 'bg-ocupada/10 text-ocupada', INACTIVO: 'bg-limpieza/15 text-limpieza' };

export function UsuariosPage() {
  const usuarios = useQuery({ queryKey: ['usuarios'], queryFn: () => api<FilaUsuario[]>('/organizacion/usuarios') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<Rol[]>('/organizacion/roles') });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="text-xs text-tinta-suave">Configuración / Usuarios y roles</div>
        <h1 className="text-2xl font-bold">Usuarios y roles</h1>
        <p className="text-sm text-tinta-suave">Lectura desde la base de datos. Crear y editar usuarios se completa en el sprint S-03 (ver maqueta aprobada).</p>
      </header>
      {usuarios.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{usuarios.error.message}</p>}

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-fondo text-left text-xs tracking-wide text-tinta-suave uppercase">
            <tr><th className="px-4 py-3">Usuario</th><th className="px-4 py-3">Rol</th><th className="px-4 py-3">Sucursales</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3">Último acceso</th></tr>
          </thead>
          <tbody>
            {usuarios.data?.map((u) => (
              <tr key={u.id} className="border-t border-borde">
                <td className="px-4 py-3"><div className="font-semibold">{u.nombre}</div><div className="font-mono text-xs text-tinta-suave">{u.username}</div></td>
                <td className="px-4 py-3 text-xs font-semibold tracking-wide">{u.rol}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.sucursales.map((s) => (
                      <span key={s.id} className={clsx('rounded-md border px-2 py-0.5 text-xs', s.principal ? 'border-acento text-acento' : 'border-borde')}>{s.nombre}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3"><span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-semibold', PILL[u.estado])}>{u.estado.toLowerCase()}</span></td>
                <td className="px-4 py-3 text-tinta-suave tabular-nums">{u.ultimoAcceso ? new Date(u.ultimoAcceso).toLocaleString('es-PE') : 'Nunca'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {roles.data?.map((r) => (
          <Card key={r.id} className="flex flex-col gap-2 p-4">
            <div className="flex items-baseline justify-between"><b className="tracking-wide">{r.nombre}</b><span className="text-xs text-tinta-suave">{r.permisos.length} permisos</span></div>
            <div className="flex flex-wrap gap-1">
              {r.permisos.map((p) => <span key={p} className="rounded bg-fondo px-1.5 py-0.5 font-mono text-[11px]">{p}</span>)}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
