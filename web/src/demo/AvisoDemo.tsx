/** Cinta fija de la demostración web: deja claro que los datos son de ejemplo y permite reiniciarla. */
export function AvisoDemo() {
  async function reiniciar() {
    const { reiniciarDemo } = await import('./servidor');
    reiniciarDemo();
    location.reload();
  }
  return (
    <div className="fixed right-3 bottom-3 z-50 flex items-center gap-3 rounded-xl bg-tinta px-4 py-2 text-xs text-white shadow-lg">
      <span><b>Demostración</b><span className="hidden sm:inline"> · datos de ejemplo · los cambios quedan solo en este navegador</span></span>
      <button onClick={reiniciar} className="rounded-md bg-white/15 px-2 py-1 font-medium hover:bg-white/25">Reiniciar demo</button>
    </div>
  );
}
