import type { EstadoReserva, TipoDocumento } from '../../lib/api';

/**
 * Lógica de pantalla de clientes, reservas y estancias (spec S-06). Las mismas reglas las vuelve a validar la API;
 * aquí solo sirven para avisar antes de enviar.
 */

export const TIPOS_DOCUMENTO: Array<{ codigo: TipoDocumento; texto: string; persona: boolean }> = [
  { codigo: '1', texto: 'DNI', persona: true },
  { codigo: '4', texto: 'Carnet de extranjería', persona: true },
  { codigo: '7', texto: 'Pasaporte', persona: true },
  { codigo: 'A', texto: 'Cédula diplomática', persona: true },
  { codigo: '6', texto: 'RUC (empresa)', persona: false },
];

export const MOTIVOS_VIAJE = ['Turismo', 'Negocios', 'Trabajo', 'Salud', 'Estudios', 'Visita familiar', 'Otro'] as const;

const PATRONES: Record<TipoDocumento, { patron: RegExp; ayuda: string }> = {
  '0': { patron: /^[A-Z0-9-]{1,15}$/, ayuda: 'Hasta 15 letras, dígitos o guiones' },
  '1': { patron: /^\d{8}$/, ayuda: '8 dígitos' },
  '4': { patron: /^[A-Z0-9]{6,12}$/, ayuda: 'De 6 a 12 letras o dígitos' },
  '6': { patron: /^(10|15|16|17|20)\d{9}$/, ayuda: '11 dígitos; empieza con 10, 15, 16, 17 o 20' },
  '7': { patron: /^[A-Z0-9]{6,12}$/, ayuda: 'De 6 a 12 letras o dígitos' },
  A: { patron: /^[A-Z0-9]{6,15}$/, ayuda: 'De 6 a 15 letras o dígitos' },
};

export function ayudaDocumento(tipo: TipoDocumento): string {
  return PATRONES[tipo].ayuda;
}

function rucValido(ruc: string): boolean {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(ruc[i]), 0);
  return (11 - (suma % 11)) % 10 === Number(ruc[10]);
}

/** null si el documento es válido; si no, el motivo. */
export function errorDocumento(tipo: TipoDocumento, numero: string): string | null {
  const limpio = numero.replace(/\s+/g, '').toUpperCase();
  if (!limpio) return 'Escribe el número de documento';
  if (!PATRONES[tipo].patron.test(limpio)) return PATRONES[tipo].ayuda;
  if (tipo === '6' && !rucValido(limpio)) return 'El RUC no es válido (dígito verificador)';
  return null;
}

export const ESTILO_RESERVA: Record<EstadoReserva, { etiqueta: string; clase: string }> = {
  PENDIENTE: { etiqueta: 'Pendiente', clase: 'bg-reservada/10 border-reservada/50 text-reservada' },
  CONFIRMADA: { etiqueta: 'Confirmada', clase: 'bg-confirmada/12 border-confirmada/50 text-confirmada' },
  EN_CURSO: { etiqueta: 'En curso', clase: 'bg-ocupada/10 border-ocupada/50 text-ocupada' },
  FINALIZADA: { etiqueta: 'Finalizada', clase: 'bg-fondo border-borde text-tinta-suave' },
  CANCELADA: { etiqueta: 'Anulada', clase: 'bg-fondo border-borde text-tinta-suave line-through' },
  NO_SHOW: { etiqueta: 'No se presentó', clase: 'bg-fondo border-borde text-tinta-suave' },
};

// ── Fechas en hora de Lima (UTC−5 todo el año) ──────────────────

const DIA_MS = 86_400_000;

/** `YYYY-MM-DD` del día de Lima en que cae el instante. */
export function diaLima(instante: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante);
}

export function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Fecha y hora de Lima (`2026-11-25`, `14:00`) → ISO con su zona, como la espera la API. */
export function instanteLima(dia: string, hora: string): string {
  return `${dia}T${hora}:00-05:00`;
}

/** Posición de un bloque en la grilla de `dias` días desde `desde`, en días (fracciones incluidas); null si queda fuera. */
export function ubicarBloque(inicio: Date, fin: Date, desde: string, dias: number): { desde: number; hasta: number } | null {
  const cero = new Date(`${desde}T00:00:00-05:00`).getTime();
  const a = Math.max(0, (inicio.getTime() - cero) / DIA_MS);
  const b = Math.min(dias, (fin.getTime() - cero) / DIA_MS);
  return b > a ? { desde: a, hasta: b } : null;
}

export function horaLima(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit' });
}

export function fechaHoraLima(iso: string): string {
  return new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Total de una reserva: precio de cada habitación × turnos, en céntimos para no sumar flotantes. */
export function totalReserva(precios: Array<string | null>, turnos: number): number | null {
  if (precios.some((p) => p === null)) return null;
  const centimos = precios.reduce((s, p) => s + Math.round(Number(p) * 100), 0);
  return (centimos * turnos) / 100;
}
