/** Reglas de usuarios (spec S-03 §4.2–§4.3). Sin dependencias: se prueban sin base de datos. */

export const MAX_INTENTOS = 3;
export const ROL_ADMINISTRADOR = 'ADMINISTRADOR';

export type EstadoUsuario = 'ACTIVO' | 'BLOQUEADO' | 'INACTIVO';

export class ReglaUsuarioError extends Error {}

export function estadoUsuario(u: { activo: boolean; intentos_fallidos: number }): EstadoUsuario {
  if (!u.activo) return 'INACTIVO';
  return u.intentos_fallidos >= MAX_INTENTOS ? 'BLOQUEADO' : 'ACTIVO';
}

const USERNAME = /^[a-z0-9._-]{3,50}$/;

/** Devuelve el username normalizado (minúsculas, sin espacios alrededor) o lanza. */
export function validarUsername(valor: string): string {
  const u = valor.trim().toLowerCase();
  if (!USERNAME.test(u)) throw new ReglaUsuarioError('El usuario debe tener de 3 a 50 caracteres: letras, números, punto, guion o guion bajo');
  return u;
}

/** Lista de problemas de la contraseña; vacía si cumple la política. */
export function politicaClave(clave: string, username?: string): string[] {
  const errores: string[] = [];
  if (clave.length < 8) errores.push('Debe tener al menos 8 caracteres');
  if (clave.length > 128) errores.push('Debe tener como máximo 128 caracteres');
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(clave)) errores.push('Debe tener al menos una letra');
  if (!/\d/.test(clave)) errores.push('Debe tener al menos un número');
  if (username && clave.toLowerCase().includes(username.toLowerCase())) errores.push('No debe contener el nombre de usuario');
  return errores;
}

export function exigirPoliticaClave(clave: string, username?: string): void {
  const errores = politicaClave(clave, username);
  if (errores.length) throw new ReglaUsuarioError(`Contraseña no válida: ${errores.join('; ').toLowerCase()}`);
}

export interface AsignacionSucursal {
  id: number;
  principal: boolean;
}

/** Al menos una sucursal, todas de la empresa, sin repetir y exactamente una principal. */
export function validarSucursales(asignadas: AsignacionSucursal[], deLaEmpresa: number[]): void {
  if (asignadas.length === 0) throw new ReglaUsuarioError('Asigna al menos una sucursal');
  const ids = asignadas.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new ReglaUsuarioError('Hay sucursales repetidas');
  const ajenas = ids.filter((id) => !deLaEmpresa.includes(id));
  if (ajenas.length) throw new ReglaUsuarioError('Hay sucursales que no pertenecen a la empresa');
  const principales = asignadas.filter((s) => s.principal).length;
  if (principales !== 1) throw new ReglaUsuarioError('Marca exactamente una sucursal como principal');
}

/** true si cambiaron las sucursales asignadas o la principal (comparación sin importar el orden). */
export function cambiaronSucursales(antes: AsignacionSucursal[], despues: AsignacionSucursal[]): boolean {
  const clave = (l: AsignacionSucursal[]) => l.map((s) => `${s.id}:${s.principal ? 1 : 0}`).sort().join(',');
  return clave(antes) !== clave(despues);
}
