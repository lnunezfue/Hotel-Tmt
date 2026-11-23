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

// ── Plano del hotel y comodidades (S-06) ─────────────────────────

export type TipoElementoPlano = 'PASILLO' | 'ESCALERA' | 'ASCENSOR' | 'RECEPCION' | 'AREA_COMUN' | 'BANO_COMUN';

export interface HabitacionPlano {
  id: number;
  numero: string;
  descripcion: string | null;
  estado: Estado;
  tipo: { id: number; nombre: string; adultos: number; ninos: number };
  amenidades: string[];
  x: number;
  y: number;
  ancho: number;
  alto: number;
  ubicada: boolean;
  estancia: null | { huesped: string | null; salidaPrevista: string; alerta: 'VENCIDA' | 'POR_VENCER' | null };
}

export interface ElementoPlano {
  id?: number;
  tipo: TipoElementoPlano;
  etiqueta: string | null;
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export interface PisoPlano {
  id: number;
  numero: number;
  nombre: string;
  columnas: number;
  filas: number;
  elementos: ElementoPlano[];
  habitaciones: HabitacionPlano[];
}

export interface Amenidad {
  id: number;
  codigo: string;
  nombre: string;
  icono: string;
  activo: boolean;
  habitaciones: number;
}

// ── Reservas (S-06) ──────────────────────────────────────────────

export type EstadoReserva = 'PENDIENTE' | 'CONFIRMADA' | 'EN_CURSO' | 'FINALIZADA' | 'CANCELADA' | 'NO_SHOW';

export interface Reserva {
  id: number;
  codigo: string;
  estado: EstadoReserva;
  entrada: string;
  salida: string;
  adultos: number;
  ninos: number;
  total: string;
  adelanto: string;
  saldo: string;
  observaciones: string | null;
  codigoExterno: string | null;
  motivoCancelacion: string | null;
  creada: string;
  canal: { id: number; nombre: string; esOta: boolean };
  cliente: { id: number; documento: string; nombre: string; telefono: string | null; pais: string };
  habitaciones: Array<{ id: number; numero: string; tipo: string; turno: string; horasTurno: number; cantidad: number; precio: string }>;
}

export interface Disponibilidad {
  entrada: string;
  salida: string;
  habitaciones: Array<{ id: number; numero: string; tipo: { id: number; nombre: string; adultos: number; ninos: number }; libre: boolean; motivo: string | null; aviso: string | null }>;
}

export interface Cliente {
  id: number;
  documento: string;
  nombre: string;
  telefono: string | null;
  pais: string;
}
