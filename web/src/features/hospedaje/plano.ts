/**
 * Geometría del plano en el cliente: la misma regla que el servidor (api/src/modules/hospedaje/domain/plano.ts)
 * para avisar mientras se arrastra. El servidor vuelve a validar al guardar.
 */
export interface Rect {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export const LIMITES = { columnas: [4, 30], filas: [3, 20], lado: 10 } as const;

export function seSuperponen(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.ancho && b.x < a.x + a.ancho && a.y < b.y + b.alto && b.y < a.y + a.alto;
}

export function dentro(r: Rect, columnas: number, filas: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.ancho <= columnas && r.y + r.alto <= filas;
}

/** ¿Se puede poner `r` sin salirse ni chocar con `otros`? */
export function cabe(r: Rect, columnas: number, filas: number, otros: Rect[]): boolean {
  return dentro(r, columnas, filas) && !otros.some((o) => seSuperponen(o, r));
}

export function buscarHueco(columnas: number, filas: number, ocupados: Rect[], tamano: Pick<Rect, 'ancho' | 'alto'>): Rect | null {
  for (let y = 0; y + tamano.alto <= filas; y++) {
    for (let x = 0; x + tamano.ancho <= columnas; x++) {
      const r = { x, y, ...tamano };
      if (!ocupados.some((o) => seSuperponen(o, r))) return r;
    }
  }
  return null;
}

/** Vista previa del piso nuevo (misma distribución que crea el servidor). */
export function distribucionInicial(cantidad: number): { columnas: number; filas: number; habitaciones: Rect[]; pasillo: Rect; escalera: Rect } {
  const ancho = 3;
  const alto = 2;
  const arriba = Math.ceil(cantidad / 2);
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
    habitaciones.push({ x: 1 + (k % porFila) * ancho, y: enArriba ? fila * alto : yPasillo + 1 + fila * alto, ancho, alto });
  }
  return {
    columnas,
    filas: Math.min(LIMITES.filas[1], yPasillo + 1 + filasAbajo * alto),
    habitaciones,
    pasillo: { x: 1, y: yPasillo, ancho: columnas - 1, alto: 1 },
    escalera: { x: 0, y: yPasillo, ancho: 1, alto: 1 },
  };
}

/** Lado por el que se entra a la habitación: el que da al pasillo más cercano (para dibujar la puerta). */
export type Lado = 'arriba' | 'abajo' | 'izquierda' | 'derecha';
export function ladoPuerta(h: Rect, pasillos: Rect[]): Lado {
  let mejor: { lado: Lado; d: number } = { lado: 'abajo', d: Infinity };
  for (const p of pasillos) {
    const cx = h.x + h.ancho / 2;
    const cy = h.y + h.alto / 2;
    const px = Math.max(p.x, Math.min(cx, p.x + p.ancho));
    const py = Math.max(p.y, Math.min(cy, p.y + p.alto));
    const dx = px - cx;
    const dy = py - cy;
    const d = Math.hypot(dx, dy);
    if (d < mejor.d) mejor = { lado: Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'abajo' : 'arriba') : dx > 0 ? 'derecha' : 'izquierda', d };
  }
  return mejor.lado;
}

/** Siguiente número libre para una habitación del piso: 401, 402... */
export function siguienteNumero(piso: number, usados: string[]): string {
  for (let k = 1; k < 100; k++) {
    const n = `${piso}${String(k).padStart(2, '0')}`;
    if (!usados.includes(n)) return n;
  }
  return `${piso}99`;
}
