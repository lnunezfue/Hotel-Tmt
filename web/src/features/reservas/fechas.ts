/** Fechas de calendario en hora de Lima (AAAA-MM-DD), sin depender de la zona del navegador. */
export function hoyLima(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Fecha de Lima de un instante ISO. */
export function fechaDe(iso: string): string {
  return hoyLima(new Date(iso));
}

/** Diferencia en días entre dos fechas AAAA-MM-DD. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/** Posición (en días, con fracción) de un instante dentro de un calendario que empieza a las 00:00 de Lima de `inicio`. */
export function posicionEnDias(iso: string, inicio: string): number {
  return (Date.parse(iso) - Date.parse(`${inicio}T05:00:00Z`)) / 86_400_000;
}

export function diaCorto(fecha: string): { semana: string; dia: string; mes: string } {
  const d = new Date(`${fecha}T12:00:00Z`);
  return {
    semana: d.toLocaleDateString('es-PE', { weekday: 'short', timeZone: 'UTC' }).replace('.', ''),
    dia: d.toLocaleDateString('es-PE', { day: '2-digit', timeZone: 'UTC' }),
    mes: d.toLocaleDateString('es-PE', { month: 'short', timeZone: 'UTC' }).replace('.', ''),
  };
}

export function horaLima(iso: string): string {
  return new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
