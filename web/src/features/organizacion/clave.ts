/** Misma política que el servidor (api/src/modules/organizacion/domain/usuario.ts); aquí solo orienta al usuario. */
export function problemasClave(clave: string, username?: string): string[] {
  const p: string[] = [];
  if (clave.length < 8) p.push('al menos 8 caracteres');
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(clave)) p.push('una letra');
  if (!/\d/.test(clave)) p.push('un número');
  if (username && clave.toLowerCase().includes(username.toLowerCase())) p.push('no contener el usuario');
  return p;
}

/** Contraseña temporal legible para dictarla en recepción (sin 0/O ni 1/l). */
export function generarClaveTemporal(azar: () => number = Math.random): string {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const digitos = '23456789';
  const elegir = (s: string) => s[Math.floor(azar() * s.length)];
  const palabra = Array.from({ length: 4 }, () => elegir(letras)).join('');
  return `${palabra[0].toUpperCase()}${palabra.slice(1)}-${Array.from({ length: 4 }, () => elegir(digitos)).join('')}`;
}
