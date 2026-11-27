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
  /** Para el precio del check-in directo (S-07). */
  tipoId?: number;
  capacidad: number;
  estado: Estado;
  estadoDescripcion: string;
  color: string;
  siguientes: Estado[];
  estancia: null | { id: number; huesped: string | null; checkin: string; salidaPrevista: string; alerta: 'VENCIDA' | 'POR_VENCER' | null };
  /** Desde cuándo está en su estado (último cambio del historial). */
  estadoDesde?: string | null;
  /** En limpieza: minutos que lleva y si pasó el tiempo esperado de la sucursal. */
  limpieza?: null | { minutos: number; demorada: boolean; esperados: number };
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
  /** Comisión del canal fijada al reservar (S-07). */
  comision: { porcentaje: string; monto: string };
  adelanto: string;
  saldo: string;
  observaciones: string | null;
  codigoExterno: string | null;
  motivoCancelacion: string | null;
  /** Quién canceló o marcó «no se presentó», y cuándo (RF-RES-16). */
  canceladaPor: string | null;
  canceladaEn: string | null;
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

/** Ficha completa del cliente (pantalla Clientes). */
export interface ClienteDetalle extends Cliente {
  tipoDocumentoId: number;
  numeroDocumento: string;
  nombres: string | null;
  apellidos: string | null;
  razonSocial: string | null;
  paisNombre: string;
  direccion: string | null;
  fechaNacimiento: string | null;
  sexo: 'M' | 'F' | 'X' | null;
  email: string | null;
  observaciones: string | null;
  activo: boolean;
}

export interface FilaLibro {
  estanciaId: number;
  entrada: string;
  salida: string | null;
  habitacion: string;
  huesped: string;
  documento: string;
  nacionalidad: string;
  fechaNacimiento: string | null;
  sexo: string | null;
  procedencia: string | null;
  destino: string | null;
  motivoViaje: string | null;
  titular: boolean;
}

// ── Estadía, cobro y caja (S-07) ─────────────────────────────────

export interface LineaCuenta {
  tipo: 'HOSPEDAJE' | 'CARGO';
  descripcion: string;
  cantidad: number;
  precioUnitario: string;
  total: string;
  cargoId?: string;
  /** Estadía de la línea (cuando se cobran varias habitaciones juntas). */
  estanciaId?: string;
}

export interface Cuenta {
  /** Todo lo consumido (hospedaje, extensiones, salida tardía, cargos). */
  lineas: LineaCuenta[];
  /** Lo que aún no tiene comprobante: el próximo cobro emite exactamente esto (operación real). */
  pendientes: LineaCuenta[];
  total: string;
  porCobrar: string;
  /** Lo ya cobrado (al ingreso o en cobros anteriores) y sus comprobantes. */
  cobrado: string;
  comprobantes: Array<{ id: number; numero: string; total: string }>;
  adelanto: string;
  saldo: string;
  comision: { porcentaje: string; monto: string };
  reserva: { id: number; codigo: string } | null;
}

export interface Estancia {
  id: number;
  estado: 'ACTIVA' | 'FINALIZADA' | 'ANULADA';
  habitacion: { id: number; numero: string; tipo: string; capacidad: number };
  checkin: string;
  salidaPrevista: string;
  checkout: string | null;
  turno: string;
  horasTurno: number;
  cantidad: number;
  precio: string;
  canal: string;
  procedencia: string | null;
  destino: string | null;
  motivoViaje: string | null;
  placa: string | null;
  reserva: string | null;
  huespedes: Array<{ id: number; titular: boolean; nombre: string; documento: string }>;
  cargos: Array<{ id: number; descripcion: string; cantidad: number; precio: string; total: string; fecha: string }>;
  cuenta: Cuenta;
  grupo: Array<{ id: number; habitacion: string }>;
}

export interface Producto { id: number; codigo: string; nombre: string; precio: string; categoria: string; tipo: 'BIEN' | 'SERVICIO' }
export interface MetodoPago { id: number; codigo: string; descripcion: string; es_efectivo: boolean }

/** Resultado de un cobro o de un check-out. Con la cuenta ya pagada, el check-out no emite comprobante. */
export interface ResultadoCheckout { cerrada: boolean; comprobanteId: number | null; comprobante: string | null; total: string; descuento: string; vuelto: string }

/** Cómo trabaja la sucursal (operación real): cobro al ingreso, consumos, limpieza y horas de salida. */
export interface FranjaSalida { nombre: string; desde: string; hasta: string; salidaMaxima: string; diasDespues: number }
export interface Operacion {
  configurada: boolean;
  cobroAlIngreso: boolean;
  vendeConsumos: boolean;
  minutosLimpieza: number;
  horaSalidaNoche: string | null;
  turnoSugeridoId: number | null;
  franjas: FranjaSalida[];
}

/** Serie de comprobantes de la sucursal (S-07). */
export interface SerieComprobante {
  id: number;
  tipo: 'FACTURA' | 'BOLETA' | 'INTERNO' | 'NOTA_CREDITO' | 'NOTA_DEBITO';
  tipoDescripcion: string;
  serie: string;
  ultimoNumero: number;
  siguiente: string;
  comprobantes: number;
  contingencia: boolean;
  activo: boolean;
  usuarios: Array<{ id: number; username: string; nombre: string }>;
}
export interface SerieParaEmitir { id: number; serie: string; siguiente: string }

export interface Comprobante {
  id: number;
  tipo: 'BOLETA' | 'FACTURA' | 'INTERNO';
  tipoDescripcion: string;
  numero: string;
  fecha: string;
  hora: string;
  emisor: { ruc: string; razonSocial: string; nombreComercial: string | null; direccion: string | null; sucursal: string };
  cliente: { tipoDoc: string; documento: string; nombre: string; direccion: string | null };
  lineas: Array<{ item: number; descripcion: string; cantidad: number; precio: string; total: string }>;
  gravada: string;
  igv: string;
  /** Descuento global con IGV (S-07). */
  descuento: string;
  descuentoMotivo: string | null;
  total: string;
  letras: string | null;
  pagos: Array<{ metodo: string; monto: string; referencia: string | null }>;
  estadoSunat: string;
  reserva: string | null;
  cajero: string;
}

export interface SesionCaja {
  id: number;
  caja: { id: number; nombre: string };
  usuario: string;
  apertura: string;
  montoApertura: string;
  estado: 'ABIERTA' | 'CERRADA';
  efectivoEsperado: string;
  porMetodo: Array<{ codigo: string; metodo: string; efectivo: boolean; ingresos: string; egresos: string }>;
  movimientos: Array<{ id: number; fecha: string; concepto: string; codigo: string; tipo: 'INGRESO' | 'EGRESO'; metodo: string; monto: string; descripcion: string | null; reserva: string | null; usuario: string }>;
  cierre?: string;
  esperado?: string;
  declarado?: string;
  diferencia?: string;
}

export interface EstadoCaja {
  cajas: Array<{ id: number; nombre: string }>;
  sesion: SesionCaja | null;
  ultimoCierre: null | { id: number; cierre: string; esperado: string; declarado: string; diferencia: string; usuario: string };
}
