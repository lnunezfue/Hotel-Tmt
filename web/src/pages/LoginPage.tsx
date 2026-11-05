import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useLogin, useSesion } from '../features/auth/sesion';
import { mensajeCierre } from '../features/auth/motivos';
import { Button } from '../components/ui/Button';

export function LoginPage() {
  const { data: sesion } = useSesion();
  const login = useLogin();
  const [params] = useSearchParams();
  const aviso = mensajeCierre(params.get('motivo'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  if (sesion) return <Navigate to="/" replace />;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ username, password });
  };

  return (
    <div className="grid min-h-full place-items-center bg-lateral px-4">
      <form onSubmit={enviar} className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-white p-8 shadow-xl">
        <div>
          <h1 className="text-2xl font-bold">Hotel SUNAT</h1>
          <p className="text-sm text-tinta-suave">Ingresa con tu usuario del sistema</p>
        </div>
        {aviso && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{aviso}</p>}
        <label className="flex flex-col gap-1 text-sm">
          Usuario
          <input id="usuario" autoFocus className="h-10 rounded-lg border border-borde px-3" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Contraseña
          <input id="clave" type="password" className="h-10 rounded-lg border border-borde px-3" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {login.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{login.error.message}</p>}
        <Button variante="primario" className="h-10" disabled={login.isPending || !username || !password}>
          {login.isPending ? 'Ingresando…' : 'Ingresar'}
        </Button>
        <p className="text-xs text-tinta-suave">
          Datos de ejemplo: <span className="font-mono">admin</span>, <span className="font-mono">recepcion1</span>, <span className="font-mono">recepcion2</span>, <span className="font-mono">limpieza1</span> · clave <span className="font-mono">Hotel2026!</span>
        </p>
      </form>
    </div>
  );
}
