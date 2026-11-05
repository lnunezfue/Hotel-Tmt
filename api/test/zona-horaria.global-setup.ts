/**
 * Corre en el proceso real de Jest antes de cargar las pruebas. Con --runInBand las pruebas se ejecutan en este
 * mismo proceso, así que la zona queda efectiva (en `setupFiles`, process.env está aislado y no la cambia).
 * La API corre con la zona de Perú mientras MySQL guarda UTC (spec §12, Review Focus 3).
 */
export default function zonaHoraria(): void {
  process.env.TZ = 'America/Lima';
}
