const MENSAJES: Record<string, string> = {
  INACTIVIDAD: 'Tu sesión se cerró por inactividad. Vuelve a ingresar.',
  EXPIRADA: 'Tu turno de sesión terminó. Vuelve a ingresar.',
  REUSO: 'Cerramos tu sesión por seguridad. Vuelve a ingresar.',
  USUARIO_INACTIVO: 'Tu usuario fue desactivado. Consulta con un administrador.',
  ADMIN: 'Un administrador cerró tu sesión.',
  CAMBIO_CLAVE: 'Tu contraseña cambió. Vuelve a ingresar con la nueva.',
};

/** Texto para el aviso de la pantalla de ingreso; null si el motivo no se muestra. */
export function mensajeCierre(motivo: string | null): string | null {
  return motivo && Object.hasOwn(MENSAJES, motivo) ? MENSAJES[motivo] : null;
}
