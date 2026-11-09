import { NavLink, Outlet } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '../lib/api';
import { useInactividad } from '../features/auth/useInactividad';
import { AvisoInactividad } from './AvisoInactividad';
import { useCambiarSucursal, useLogout, useSesion, puede } from '../features/auth/sesion';

const iconos = {
  tablero: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  reservas: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  usuarios: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c.8-3.6 3.6-6 7-6s6.2 2.4 7 6M16 3.5a4 4 0 0 1 0 7.5M18 14.5c2 .8 3.3 2.8 3.8 6.5',
  ventas: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  caja: 'M3 7h18v13H3zM3 11h18',
  hotel: 'M3 21h18M5 21V5l7-2 7 2v16M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4',
};

function Icono({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function Enlace({ to, icono, children, proximo }: { to: string; icono: string; children: string; proximo?: string }) {
  if (proximo) {
    return (
      <span className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/40" title={`Disponible en ${proximo}`}>
        <Icono d={icono} />
        {children}
        <span className="ml-auto font-mono text-[10px] tracking-wide">{proximo}</span>
      </span>
    );
  }
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) => clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm', isActive ? 'bg-lateral-activo font-semibold text-white' : 'text-white/75 hover:bg-white/5')}
    >
      <Icono d={icono} />
      {children}
    </NavLink>
  );
}

export function Layout() {
  const { data: sesion } = useSesion();
  const logout = useLogout();
  const cambiar = useCambiarSucursal();
  const { cierreEn, seguir } = useInactividad(sesion?.inactividadMin);
  const { data: empresa } = useQuery({ queryKey: ['empresa'], queryFn: () => api<{ razon_social: string; ruc: string; sunat_entorno: string }>('/organizacion/empresa') });
  const { data: sucursales } = useQuery({ queryKey: ['sucursales'], queryFn: () => api<Array<{ id: number; nombre: string }>>('/organizacion/sucursales') });

  return (
    <div className="grid min-h-full grid-cols-1 lg:grid-cols-[236px_1fr]">
      <aside className="flex flex-col gap-6 bg-lateral px-4 py-5 text-white">
        <div>
          <div className="text-[15px] font-semibold">{empresa?.razon_social ?? 'Hotel'}</div>
          <div className="text-xs text-white/60">RUC {empresa?.ruc}</div>
          {empresa?.sunat_entorno === 'BETA' && (
            <span className="mt-2 inline-block rounded bg-white/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-white/80">SUNAT · BETA</span>
          )}
        </div>
        <nav className="flex flex-col gap-1" aria-label="Menú principal">
          <span className="px-3 pt-1 pb-1 text-[11px] tracking-widest text-white/45 uppercase">Hotel</span>
          <Enlace to="/" icono={iconos.tablero}>Tablero de habitaciones</Enlace>
          <Enlace to="/reservas" icono={iconos.reservas}>Reservas</Enlace>
          <Enlace to="/ventas" icono={iconos.ventas} proximo="F3">Ventas y comprobantes</Enlace>
          <Enlace to="/caja" icono={iconos.caja} proximo="F4">Caja</Enlace>
          {(puede(sesion, 'usuario.ver') || puede(sesion, 'habitacion.gestionar')) && (
            <span className="px-3 pt-3 pb-1 text-[11px] tracking-widest text-white/45 uppercase">Configuración</span>
          )}
          {puede(sesion, 'habitacion.gestionar') && <Enlace to="/configuracion/hotel" icono={iconos.hotel}>Hotel y tarifas</Enlace>}
          {puede(sesion, 'usuario.ver') && <Enlace to="/usuarios" icono={iconos.usuarios}>Usuarios y roles</Enlace>}
        </nav>
        <div className="mt-auto flex flex-col gap-3 border-t border-white/10 pt-4 text-sm">
          {sucursales && sucursales.length > 0 && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] tracking-widest text-white/45 uppercase">Sucursal</span>
              <select
                className="h-9 rounded-lg border border-white/15 bg-lateral-activo px-2 text-white"
                value={sesion?.sucursalId}
                disabled={sucursales.length < 2 || cambiar.isPending}
                onChange={(e) => cambiar.mutate(Number(e.target.value))}
              >
                {sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </label>
          )}
          <div>
            <div className="font-medium">{sesion?.nombre}</div>
            <div className="text-xs text-white/60">{sesion?.rol}</div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 whitespace-nowrap">
            <NavLink to="/mi-clave" className="text-xs text-white/70 underline-offset-2 hover:underline">Cambiar contraseña</NavLink>
            <button className="text-xs text-white/70 underline-offset-2 hover:underline" onClick={() => logout.mutate()}>Cerrar sesión</button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 lg:px-8">
        <Outlet />
      </main>
      {cierreEn !== null && <AvisoInactividad cierreEn={cierreEn} onSeguir={seguir} />}
    </div>
  );
}
