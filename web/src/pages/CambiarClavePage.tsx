import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Sesion } from '../lib/api';
import { useLogout, useSesion } from '../features/auth/sesion';
import { problemasClave } from '../features/organizacion/clave';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Aviso, Campo, Entrada } from '../components/ui/form';

/**
 * Cambio de la propia contraseña. `obligatoria`: la sesión trae una clave temporal y la API no atiende nada más
 * hasta cambiarla (S-03 §4.4); se muestra a pantalla completa, sin el menú.
 */
export function CambiarClavePage({ obligatoria = false }: { obligatoria?: boolean }) {
  const qc = useQueryClient();
  const { data: sesion } = useSesion();
  const logout = useLogout();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const faltan = nueva ? problemasClave(nueva, sesion?.username) : [];
  const distintas = repetir !== '' && repetir !== nueva;

  const cambiar = useMutation({
    mutationFn: () => api<Sesion>('/auth/clave', { method: 'POST', body: JSON.stringify({ actual, nueva }) }),
    onSuccess: (s) => {
      setActual('');
      setNueva('');
      setRepetir('');
      qc.setQueryData(['sesion'], s);
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (faltan.length || distintas || !actual) return;
    cambiar.mutate();
  }

  const formulario = (
    <Card className="flex w-full max-w-md flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-bold">{obligatoria ? 'Crea tu contraseña' : 'Cambiar mi contraseña'}</h1>
        <p className="text-sm text-tinta-suave">
          {obligatoria
            ? `Hola, ${sesion?.nombre}. Un administrador te asignó una contraseña temporal; cámbiala para empezar a trabajar.`
            : 'Al cambiarla se cierran tus sesiones abiertas en otros equipos.'}
        </p>
      </div>
      {cambiar.isSuccess && !obligatoria && <Aviso tipo="ok">Contraseña actualizada.</Aviso>}
      <form className="flex flex-col gap-3" onSubmit={enviar}>
        <Campo etiqueta={obligatoria ? 'Contraseña temporal' : 'Contraseña actual'}>
          <Entrada type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} required />
        </Campo>
        <Campo
          etiqueta="Nueva contraseña"
          ayuda={faltan.length ? `Falta: ${faltan.join(', ')}` : nueva ? 'Cumple la política' : 'Mínimo 8 caracteres, con letras y números'}
        >
          <Entrada type="password" autoComplete="new-password" value={nueva} onChange={(e) => setNueva(e.target.value)} required />
        </Campo>
        <Campo etiqueta="Repite la nueva contraseña" ayuda={distintas ? 'No coincide' : undefined}>
          <Entrada type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} required />
        </Campo>
        {cambiar.error && <Aviso>{cambiar.error.message}</Aviso>}
        <Button variante="primario" type="submit" disabled={cambiar.isPending || !actual || faltan.length > 0 || distintas || !repetir}>
          {cambiar.isPending ? 'Guardando…' : 'Guardar contraseña'}
        </Button>
        {obligatoria && (
          <Button type="button" variante="fantasma" onClick={() => logout.mutate()}>Salir</Button>
        )}
      </form>
    </Card>
  );

  if (obligatoria) return <div className="flex min-h-full items-center justify-center p-4">{formulario}</div>;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="text-xs text-tinta-suave">Mi cuenta</div>
      </header>
      {formulario}
    </div>
  );
}
