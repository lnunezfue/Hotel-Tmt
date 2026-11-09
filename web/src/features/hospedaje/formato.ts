/** "70.00" → "S/ 70.00" (montos de la API como texto decimal, sin pasar por float al mostrarlos). */
export function soles(monto: string | number): string {
  const n = typeof monto === 'number' ? monto : Number(monto);
  return `S/ ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "2026-11-20" → "20/11/2026" sin pasar por Date (evita el corrimiento de zona horaria). */
export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
