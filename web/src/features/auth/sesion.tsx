import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Sesion } from '../../lib/api';

export function useSesion() {
  return useQuery<Sesion | null>({
    queryKey: ['sesion'],
    queryFn: async () => {
      try {
        return await api<Sesion>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: { username: string; password: string }) => api<Sesion>('/auth/login', { method: 'POST', body: JSON.stringify(d) }),
    onSuccess: (s) => qc.setQueryData(['sesion'], s),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSuccess: () => { qc.setQueryData(['sesion'], null); qc.clear(); },
  });
}

export function useCambiarSucursal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sucursalId: number) => api<Sesion>('/auth/sucursal', { method: 'POST', body: JSON.stringify({ sucursalId }) }),
    onSuccess: (s) => { qc.setQueryData(['sesion'], s); qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'sesion' }); },
  });
}

export const puede = (s: Sesion | null | undefined, permiso: string) => !!s?.permisos.includes(permiso);
