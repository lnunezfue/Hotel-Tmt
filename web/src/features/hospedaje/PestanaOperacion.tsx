import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type FranjaSalida, type Operacion } from '../../lib/api';
import { puede, useSesion } from '../auth/sesion';
import { useOperacion } from './operacion';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Aviso, Campo, Entrada, Selector } from '../../components/ui/form';

interface Turno { id: number; nombre: string; duracion_horas: number }

/** Las del hotel de parejas (información del cuartelero); se ofrecen como punto de partida. */
const SUGERIDAS: FranjaSalida[] = [
  { nombre: 'Madrugada', desde: '00:00', hasta: '06:00', salidaMaxima: '12:00', diasDespues: 0 },
  { nombre: 'Mañana', desde: '06:00', hasta: '12:00', salidaMaxima: '18:00', diasDespues: 0 },
  { nombre: 'Tarde y noche', desde: '12:00', hasta: '00:00', salidaMaxima: '06:00', diasDespues: 1 },
];

/** Cómo trabaja la sucursal: cobro al ingreso, consumos, limpieza, salida de la noche y hora máxima por franja. */
export function PestanaOperacion() {
  const { data: sesion } = useSesion();
  const puedeEditar = puede(sesion, 'operacion.configurar');
  const qc = useQueryClient();
  const actual = useOperacion();
  const turnos = useQuery({ queryKey: ['reservas', 'turnos'], queryFn: () => api<Turno[]>('/hospedaje/turnos') });
  const [f, setF] = useState<Operacion | null>(null);
  useEffect(() => {
    if (actual.data && !f) setF({ ...actual.data, horaSalidaNoche: actual.data.horaSalidaNoche ?? '09:00', franjas: actual.data.configurada ? actual.data.franjas : SUGERIDAS });
  }, [actual.data, f]);
  const guardar = useMutation({
    mutationFn: (o: Operacion) => api<Operacion>('/hospedaje/operacion', { method: 'PUT', body: JSON.stringify({ ...o, configurada: undefined }) }),
    onSuccess: (o) => { qc.setQueryData(['operacion'], o); qc.invalidateQueries({ queryKey: ['tablero'] }); setF(o); },
  });
  if (!f) return <p className="text-sm text-tinta-suave">Cargando…</p>;
  const poner = (c: Partial<Operacion>) => { guardar.reset(); setF({ ...f, ...c }); };
  const ponerFranja = (i: number, c: Partial<FranjaSalida>) => poner({ franjas: f.franjas.map((x, j) => (j === i ? { ...x, ...c } : x)) });

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {!actual.data?.configurada && <Aviso tipo="info">Esta sucursal aún trabaja con las reglas de siempre (salida 12:00, sin topes, cobro al salir). Guarda para aplicar estas.</Aviso>}
      {!puedeEditar && <Aviso tipo="info">Tu rol puede ver la operación pero no cambiarla (permiso «operacion.configurar»).</Aviso>}
      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-semibold">Cobro y servicio</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={f.cobroAlIngreso} disabled={!puedeEditar} onChange={(e) => poner({ cobroAlIngreso: e.target.checked })} />
          <span><b>Cobro al ingreso</b> (pago adelantado). El check-in pide el pago; una extensión cobra la diferencia y el check-out solo cierra si ya está pagado.</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={f.vendeConsumos} disabled={!puedeEditar} onChange={(e) => poner({ vendeConsumos: e.target.checked })} />
          <span><b>Vende consumos a las habitaciones</b> (frigobar, servicios). Si no, la estadía no muestra esa sección.</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Limpieza (minutos)"><Entrada type="number" min={5} max={240} value={f.minutosLimpieza} disabled={!puedeEditar} onChange={(e) => poner({ minutosLimpieza: Number(e.target.value) })} /></Campo>
          <Campo etiqueta="Salida de la noche"><Entrada type="time" value={f.horaSalidaNoche ?? '09:00'} disabled={!puedeEditar} onChange={(e) => poner({ horaSalidaNoche: e.target.value })} /></Campo>
          <Campo etiqueta="Turno que propone el check-in">
            <Selector value={f.turnoSugeridoId ?? ''} disabled={!puedeEditar} onChange={(e) => poner({ turnoSugeridoId: Number(e.target.value) || null })}>
              <option value="">Noche</option>
              {turnos.data?.filter((t) => t.duracion_horas !== 24).map((t) => <option key={t.id} value={t.id}>{t.duracion_horas} horas</option>)}
            </Selector>
          </Campo>
        </div>
        <p className="text-xs text-tinta-suave">
          El tablero avisa cuando una habitación pasa el tiempo de limpieza. La noche o turno completo sale a la hora indicada del día siguiente; quien entra de madrugada sale ese mismo día.
        </p>
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <div>
          <h2 className="font-semibold">Hora máxima de salida según la hora del check-in</h2>
          <p className="text-xs text-tinta-suave">Para estadías por horas: el sistema no vende horas que pasen la hora máxima de la franja en que entran.</p>
        </div>
        {f.franjas.map((x, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-borde p-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_1.2fr_auto]">
            <Campo etiqueta="Franja"><Entrada value={x.nombre} disabled={!puedeEditar} onChange={(e) => ponerFranja(i, { nombre: e.target.value })} /></Campo>
            <Campo etiqueta="Desde"><Entrada type="time" value={x.desde} disabled={!puedeEditar} onChange={(e) => ponerFranja(i, { desde: e.target.value })} /></Campo>
            <Campo etiqueta="Hasta"><Entrada type="time" value={x.hasta} disabled={!puedeEditar} onChange={(e) => ponerFranja(i, { hasta: e.target.value })} /></Campo>
            <Campo etiqueta="Sale a más tardar"><Entrada type="time" value={x.salidaMaxima} disabled={!puedeEditar} onChange={(e) => ponerFranja(i, { salidaMaxima: e.target.value })} /></Campo>
            <Campo etiqueta="Día">
              <Selector value={x.diasDespues} disabled={!puedeEditar} onChange={(e) => ponerFranja(i, { diasDespues: Number(e.target.value) })}>
                <option value={0}>El mismo día</option>
                <option value={1}>Al día siguiente</option>
              </Selector>
            </Campo>
            {puedeEditar && <button className="h-9 px-1 text-tinta-suave hover:text-ocupada" aria-label={`Quitar ${x.nombre}`} onClick={() => poner({ franjas: f.franjas.filter((_, j) => j !== i) })}>✕</button>}
          </div>
        ))}
        {puedeEditar && (
          <div className="flex gap-3 text-sm">
            <button className="font-medium text-acento hover:underline" onClick={() => poner({ franjas: [...f.franjas, { nombre: 'Nueva franja', desde: '00:00', hasta: '00:00', salidaMaxima: '12:00', diasDespues: 1 }] })}>+ Agregar franja</button>
            <button className="text-tinta-suave hover:underline" onClick={() => poner({ franjas: SUGERIDAS })}>Usar las sugeridas</button>
          </div>
        )}
        <p className="text-xs text-tinta-suave">«Hasta» 00:00 es medianoche. Sin franjas, no hay hora máxima.</p>
      </Card>

      {guardar.error && <Aviso>{guardar.error.message}</Aviso>}
      {guardar.isSuccess && <Aviso tipo="ok">Operación guardada. Se aplica a los próximos check-in y reservas.</Aviso>}
      {puedeEditar && <div><Button variante="primario" disabled={guardar.isPending} onClick={() => guardar.mutate(f)}>{guardar.isPending ? 'Guardando…' : 'Guardar operación'}</Button></div>}
    </div>
  );
}
