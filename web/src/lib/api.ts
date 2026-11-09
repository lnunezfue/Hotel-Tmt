/** Cliente HTTP tipado. La sesión viaja en una cookie httpOnly; el navegador nunca ve el token (RNF-14). */
export class ApiError extends Error {
  constructor(public status: number, message: string, public codigo?: string, public motivo?: string) {
    super(message);
  }
}

const RUTAS_DE_AUTENTICACION = ['/auth/login', '/auth/refresh', '/auth/logout'];

let alCerrar: (motivo?: string) => void = () => {};

/** Registra qué hacer cuando la sesión terminó y no hay forma de renovarla. */
export function alCerrarSesion(manejador: (motivo?: string) => void): void {
  alCerrar = manejador;
}

/** Una sola renovación en vuelo, compartida por todas las peticiones que esperan. */
let renovando: Promise<void> | null = null;

function renovar(): Promise<void> {
  renovando ??= peticion<unknown>('/auth/refresh', { method: 'POST' })
    .then(() => undefined)
    .finally(() => {
      renovando = null;
    });
  return renovando;
}

async function peticion<T>(ruta: string, init: RequestInit): Promise<T> {
  const res = await fetch(`/api${ruta}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(cuerpo?.message) ? cuerpo.message.join('. ') : cuerpo?.message ?? cuerpo?.mensaje ?? 'Error inesperado';
    throw new ApiError(res.status, msg, cuerpo?.codigo, cuerpo?.motivo);
  }
  return cuerpo as T;
}

export function api<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  return ejecutar<T>(ruta, init, false);
}

async function ejecutar<T>(ruta: string, init: RequestInit, reintentada: boolean): Promise<T> {
  try {
    return await peticion<T>(ruta, init);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401 || RUTAS_DE_AUTENTICACION.includes(ruta)) throw e;

    if (e.codigo === 'ACCESO_EXPIRADO' && !reintentada) {
      try {
        await renovar();
      } catch (fallo) {
        // Solo un 401 de la renovación significa sesión terminada; 429, 5xx o red se propagan tal cual.
        if (!(fallo instanceof ApiError) || fallo.status !== 401) throw fallo;
        alCerrar(fallo.motivo);
        throw new ApiError(401, fallo.message, 'SESION_CERRADA', fallo.motivo);
      }
      return ejecutar<T>(ruta, init, true);
    }

    if ((e.codigo === 'SIN_SESION' || e.codigo === 'SESION_CERRADA') && ruta !== '/auth/me') alCerrar(e.motivo);
    throw e;
  }
}

export interface Sesion {
  sub: number;
  username: string;
  nombre: string;
  rol: string;
  permisos: string[];
  sucursales: number[];
  sucursalId: number;
  sid: string;
  inactividadMin: number;
  /** Contraseña temporal: la API solo atiende /auth/me y /auth/clave hasta cambiarla. */
  debeCambiarClave?: boolean;
}

export type Estado = 'DESOCUPADA' | 'RESERVADA' | 'CONFIRMADA' | 'OCUPADA' | 'LIMPIEZA' | 'MANTENIMIENTO';

export interface HabitacionTablero {
  id: number;
  numero: string;
  tipo: string;
  capacidad: number;
  estado: Estado;
  estadoDescripcion: string;
  color: string;
  siguientes: Estado[];
  estancia: null | { id: number; huesped: string | null; checkin: string; salidaPrevista: string; alerta: 'VENCIDA' | 'POR_VENCER' | null };
}

export interface Tablero {
  generadoEn: string;
  resumen: Partial<Record<Estado, number>>;
  pisos: Array<{ id: number; numero: number; nombre: string; habitaciones: HabitacionTablero[] }>;
}
