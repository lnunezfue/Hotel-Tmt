export interface ConfigAuth {
  jwtSecret: string;
  accesoMin: number;
  sesionMaxHoras: number;
  graciaSeg: number;
  limitePorMin: number;
  trustProxy: boolean | number;
}

function entero(env: NodeJS.ProcessEnv, nombre: string, defecto: number): number {
  const crudo = env[nombre];
  if (crudo === undefined || crudo.trim() === '') return defecto;
  if (!/^\d+$/.test(crudo.trim()) || Number(crudo) < 1) throw new Error(`${nombre} debe ser un entero positivo`);
  return Number(crudo);
}

function trustProxy(env: NodeJS.ProcessEnv): boolean | number {
  const crudo = (env.TRUST_PROXY ?? '').trim().toLowerCase();
  if (crudo === '' || crudo === 'false') return false;
  if (crudo === 'true') return true;
  if (/^\d+$/.test(crudo)) return Number(crudo);
  throw new Error('TRUST_PROXY debe ser true, false o un entero no negativo');
}

export function leerConfigAuth(env: NodeJS.ProcessEnv = process.env): ConfigAuth {
  const secreto = env.JWT_SECRET;
  if (!secreto && env.NODE_ENV === 'production') throw new Error('JWT_SECRET es obligatoria en producción');
  return {
    jwtSecret: secreto || 'solo-desarrollo',
    accesoMin: entero(env, 'JWT_ACCESO_MIN', 15),
    sesionMaxHoras: entero(env, 'SESION_MAX_HORAS', 12),
    graciaSeg: entero(env, 'REFRESH_GRACIA_SEG', 30),
    limitePorMin: entero(env, 'LIMITE_AUTH_POR_MIN', 10),
    trustProxy: trustProxy(env),
  };
}
