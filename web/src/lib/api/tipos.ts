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
  /** Reserva que llega hoy a esta habitación y aún no hace el check-in. */
  llegada: null | { reservaId: number; reservaHabitacionId: number; codigo: string; estado: EstadoReserva; titular: string; entrada: string };
  estancia: null | { id: number; huesped: string | null; checkin: string; salidaPrevista: string; alerta: 'VENCIDA' | 'POR_VENCER' | null };
}

export interface Tablero {
  generadoEn: string;
  resumen: Partial<Record<Estado, number>>;
  pisos: Array<{ id: number; numero: number; nombre: string; habitaciones: HabitacionTablero[] }>;
}

export type TipoDocumento = '0' | '1' | '4' | '6' | '7' | 'A';

export interface Cliente {
  id: number;
  tipoDocumento: TipoDocumento;
  tipoDocumentoAbrev: string;
  numeroDocumento: string;
  razonSocial: string | null;
  nombres: string | null;
  apellidos: string | null;
  nombreCompleto: string;
  esPersona: boolean;
  paisCodigo: string;
  pais: string;
  direccion: string | null;
  fechaNacimiento: string | null;
  sexo: 'M' | 'F' | 'X' | null;
  telefono: string | null;
  email: string | null;
  observaciones: string | null;
  activo: boolean;
}

export type EstadoReserva = 'PENDIENTE' | 'CONFIRMADA' | 'EN_CURSO' | 'FINALIZADA' | 'CANCELADA' | 'NO_SHOW';

export interface Reserva {
  id: number;
  codigo: string;
  estado: EstadoReserva;
  titular: { id: number; nombre: string; documento: string };
  canal: { id: number; nombre: string; esOta: boolean };
  comisionPorcentaje: string;
  codigoExterno: string | null;
  entrada: string;
  salida: string;
  adultos: number;
  ninos: number;
  montoTotal: string;
  observaciones: string | null;
  motivoCancelacion: string | null;
  canceladaPor: string | null;
  canceladaEn: string | null;
  creadaPor: string;
  creadaEn: string;
  habitaciones: Array<{
    id: number;
    habitacionId: number;
    numero: string;
    tipo: string;
    capacidad: number;
    turno: { id: number; nombre: string; horas: number };
    cantidadTurnos: number;
    precioUnitario: string;
    subtotal: string;
    estancia: { id: number; estado: string } | null;
  }>;
}

export interface BloqueCalendario {
  tipo: 'reserva' | 'estancia';
  habitacionId: number;
  inicio: string;
  fin: string;
  titular: string;
  canal: string;
  estado: string;
  reservaId: number | null;
  codigo: string | null;
  estanciaId: number | null;
}

export interface Calendario {
  desde: string;
  dias: number;
  habitaciones: Array<{ id: number; numero: string; tipo: string; piso: string }>;
  bloques: BloqueCalendario[];
}

export interface Disponibles {
  entrada: string;
  salida: string;
  habitaciones: Array<{ id: number; numero: string; piso: string; tipo: string; capacidad: number; estado: Estado; precio: string | null }>;
}

export interface Liquidacion {
  salida: string;
  contratados: number;
  consumidos: number;
  adicionales: number;
  precioUnitario: string;
  importe: string;
}

export interface Estancia {
  id: number;
  estado: 'ACTIVA' | 'FINALIZADA' | 'ANULADA';
  habitacion: { id: number; numero: string; tipo: string };
  reserva: { id: number; codigo: string } | null;
  canal: { id: number; nombre: string };
  comisionPorcentaje: string;
  turno: { id: number; nombre: string; horas: number };
  cantidadTurnos: number;
  precioUnitario: string;
  montoHospedaje: string;
  checkin: string;
  salidaPrevista: string;
  salida: string | null;
  procedencia: string | null;
  destino: string | null;
  motivoViaje: string | null;
  placaVehiculo: string | null;
  ingresoPor: string;
  salidaPor: string | null;
  huespedes: Array<{ id: number; nombre: string; documento: string; paisCodigo: string; titular: boolean }>;
  liquidacion: Liquidacion | null;
}

export interface CanalActivo { id: number; nombre: string; es_ota: boolean; comision_porcentaje: string }
export interface TurnoActivo { id: number; nombre: string; duracion_horas: number }
export interface Pais { codigo: string; nombre: string }
