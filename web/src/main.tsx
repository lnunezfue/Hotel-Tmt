import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { TableroPage } from './pages/TableroPage';
import { ReservasPage } from './pages/ReservasPage';
import { UsuariosPage } from './pages/UsuariosPage';
import { puede, useSesion } from './features/auth/sesion';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });

/** Rutas protegidas según la sesión y el permiso del rol (la API vuelve a verificar cada acción). */
function Protegida({ children, permiso }: { children: ReactNode; permiso?: string }) {
  const { data: sesion, isLoading } = useSesion();
  if (isLoading) return <div className="p-8 text-tinta-suave">Cargando…</div>;
  if (!sesion) return <Navigate to="/login" replace />;
  if (permiso && !puede(sesion, permiso)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Protegida><Layout /></Protegida>}>
            <Route index element={<TableroPage />} />
            <Route path="reservas" element={<ReservasPage />} />
            <Route path="usuarios" element={<Protegida permiso="usuario.ver"><UsuariosPage /></Protegida>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
