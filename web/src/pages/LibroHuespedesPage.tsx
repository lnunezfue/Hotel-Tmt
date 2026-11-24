import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type FilaLibro } from '../lib/api';
import { hoyLima, sumarDias } from '../features/reservas/fechas';
import { Card } from '../components/ui/Card';
import { Aviso, Campo, Entrada } from '../components/ui/form';

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Libro de registro de entrada y salida de huéspedes (RF-RES-11), por fecha de ingreso. */
export function LibroHuespedesPage() {
  const hoy = hoyLima();
  const [desde, setDesde] = useState(sumarDias(hoy, -6));
  const [hasta, setHasta] = useState(hoy);
  const libro = useQuery({ queryKey: ['libro', desde, hasta], queryFn: () => api<FilaLibro[]>(`/libro-huespedes?desde=${desde}&hasta=${hasta}`) });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="text-xs text-tinta-suave">Hotel / Libro de huéspedes</div>
        <h1 className="text-2xl font-bold">Libro de registro de huéspedes</h1>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <Campo etiqueta="Ingreso desde"><Entrada type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} /></Campo>
        <Campo etiqueta="hasta"><Entrada type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} /></Campo>
        <span className="pb-2 text-xs text-tinta-suave">Hasta 31 días · {libro.data?.length ?? 0} registros</span>
        <button className="ml-auto pb-2 text-sm font-medium text-acento hover:underline" onClick={() => window.print()}>Imprimir</button>
      </div>
      {libro.error && <Aviso>{libro.error.message}</Aviso>}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-borde bg-fondo text-left text-xs tracking-wide text-tinta-suave uppercase">
            <tr>{['Ingreso', 'Salida', 'Hab.', 'Huésped', 'Documento', 'Nacionalidad', 'Procedencia', 'Destino', 'Motivo'].map((t) => <th key={t} className="px-3 py-2 whitespace-nowrap">{t}</th>)}</tr>
          </thead>
          <tbody>
            {libro.data?.map((f) => (
              <tr key={`${f.estanciaId}-${f.documento}`} className="border-b border-borde last:border-0">
                <td className="px-3 py-2 whitespace-nowrap">{fechaHora(f.entrada)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-tinta-suave">{f.salida ? fechaHora(f.salida) : 'alojado'}</td>
                <td className="px-3 py-2 tabular-nums">{f.habitacion}</td>
                <td className="px-3 py-2">{f.huesped}{f.titular && <span className="ml-1 text-xs text-tinta-suave">(titular)</span>}</td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{f.documento}</td>
                <td className="px-3 py-2">{f.nacionalidad}</td>
                <td className="px-3 py-2">{f.procedencia ?? '—'}</td>
                <td className="px-3 py-2">{f.destino ?? '—'}</td>
                <td className="px-3 py-2">{f.motivoViaje ?? '—'}</td>
              </tr>
            ))}
            {libro.data?.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-tinta-suave">Sin ingresos en ese rango.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
