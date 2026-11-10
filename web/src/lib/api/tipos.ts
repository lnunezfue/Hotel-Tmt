/** Tipos compartidos con la API. */
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
