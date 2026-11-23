/**
 * Plano de un piso (spec S-06 §4): una cuadrícula de `columnas × filas` celdas donde las habitaciones y los
 * elementos (pasillo, escalera...) ocupan rectángulos que no se superponen. Lógica pura, sin base de datos.
 */

export class ReglaPlanoError extends Error {}

export interface Rect {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export interface PiezaPlano extends Rect {
  /** Para los mensajes: "habitación 101", "escalera". */
  nombre: string;
}

export const LIMITES = { columnas: [4, 30], filas: [3, 20], lado: 10 } as const;
export const TAMANO_HABITACION: Pick<Rect, 'ancho' | 'alto'> = { ancho: 3, alto: 2 };

export function seSuperponen(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.ancho && b.x < a.x + a.ancho && a.y < b.y + b.alto && b.y < a.y + a.alto;
}

export function validarDimensiones(columnas: number, filas: number): void {
  const entero = (n: number) => Number.isInteger(n);
  if (!entero(columnas) || columnas < LIMITES.columnas[0] || columnas > LIMITES.columnas[1]) {
    throw new ReglaPlanoError(`El ancho del plano debe estar entre ${LIMITES.columnas[0]} y ${LIMITES.columnas[1]} celdas`);
  }
  if (!entero(filas) || filas < LIMITES.filas[0] || filas > LIMITES.filas[1]) {
    throw new ReglaPlanoError(`El alto del plano debe estar entre ${LIMITES.filas[0]} y ${LIMITES.filas[1]} celdas`);
  }
}

/** Todas las piezas dentro del plano y sin superponerse. Lanza con un mensaje que nombra el problema. */
export function validarPlano(columnas: number, filas: number, piezas: PiezaPlano[]): void {
  validarDimensiones(columnas, filas);
  for (const p of piezas) {
    if (![p.x, p.y, p.ancho, p.alto].every(Number.isInteger) || p.ancho < 1 || p.alto < 1) {
      throw new ReglaPlanoError(`Medidas no válidas para ${p.nombre}`);
    }
    if (p.x < 0 || p.y < 0 || p.x + p.ancho > columnas || p.y + p.alto > filas) {
      throw new ReglaPlanoError(`${capital(p.nombre)} queda fuera del plano`);
    }
  }
  for (let i = 0; i < piezas.length; i++) {
    for (let j = i + 1; j < piezas.length; j++) {
      if (seSuperponen(piezas[i], piezas[j])) throw new ReglaPlanoError(`${capital(piezas[i].nombre)} se superpone con ${piezas[j].nombre}`);
    }
  }
}

/** Primer hueco libre (de arriba a la izquierda) donde cabe un rectángulo del tamaño dado; null si no hay. */
export function buscarHueco(columnas: number, filas: number, ocupados: Rect[], tamano: Pick<Rect, 'ancho' | 'alto'>): Rect | null {
  for (let y = 0; y + tamano.alto <= filas; y++) {
    for (let x = 0; x + tamano.ancho <= columnas; x++) {
      const r = { x, y, ...tamano };
      if (!ocupados.some((o) => seSuperponen(o, r))) return r;
    }
  }
  return null;
}

/**
 * Ubica las habitaciones que aún no tienen posición, sin mover las ubicadas. Si no caben, agrega filas
 * (hasta el máximo). Devuelve las posiciones nuevas y las filas que necesita el plano.
 */
export function ubicarPendientes(
  columnas: number,
  filas: number,
  ocupados: Rect[],
  pendientes: Array<{ id: number; ancho: number; alto: number }>,
): { filas: number; posiciones: Map<number, Rect> } {
  const posiciones = new Map<number, Rect>();
  const tomados = [...ocupados];
  let alto = filas;
  for (const p of pendientes) {
    const tamano = { ancho: Math.min(p.ancho, columnas), alto: p.alto };
    let hueco = buscarHueco(columnas, alto, tomados, tamano);
    while (!hueco && alto + tamano.alto <= LIMITES.filas[1]) {
      alto += tamano.alto;
      hueco = buscarHueco(columnas, alto, tomados, tamano);
    }
    if (!hueco) continue; // sin espacio: queda sin ubicar y el cliente la muestra en la bandeja
    posiciones.set(p.id, hueco);
    tomados.push(hueco);
  }
  return { filas: alto, posiciones };
}

/**
 * Distribución inicial de un piso: una fila de habitaciones arriba, el pasillo al medio con la escalera y otra
 * fila abajo. Es la que usa el seed y la que propone la pantalla al crear un piso.
 */
export function distribucionInicial(cantidad: number): { columnas: number; filas: number; habitaciones: Rect[]; pasillo: Rect; escalera: Rect } {
  const { ancho, alto } = TAMANO_HABITACION;
  const arriba = Math.ceil(cantidad / 2);
  // Una sola fila arriba y otra abajo mientras quepan; la columna 0 del pasillo es la escalera.
  const porFila = Math.max(1, Math.min(Math.floor((LIMITES.columnas[1] - 1) / ancho), Math.max(arriba, 4)));
  const columnas = 1 + porFila * ancho;
  const filasArriba = Math.max(1, Math.ceil(arriba / porFila));
  const filasAbajo = Math.max(1, Math.ceil((cantidad - arriba) / porFila));
  const yPasillo = filasArriba * alto;
  const habitaciones: Rect[] = [];
  for (let i = 0; i < cantidad; i++) {
    const enArriba = i < arriba;
    const k = enArriba ? i : i - arriba;
    const fila = Math.floor(k / porFila);
    const col = k % porFila;
    const y = enArriba ? fila * alto : yPasillo + 1 + fila * alto;
    habitaciones.push({ x: 1 + col * ancho, y, ancho, alto });
  }
  return {
    columnas,
    filas: Math.min(LIMITES.filas[1], yPasillo + 1 + filasAbajo * alto),
    habitaciones,
    pasillo: { x: 1, y: yPasillo, ancho: columnas - 1, alto: 1 },
    escalera: { x: 0, y: yPasillo, ancho: 1, alto: 1 },
  };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
