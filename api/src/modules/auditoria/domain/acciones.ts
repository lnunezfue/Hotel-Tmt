export const ACCIONES_AUDITORIA = ['auth.login', 'auth.login_fallido', 'auth.logout', 'auth.sesion_revocada', 'auth.cambio_sucursal', 'habitacion.crear'] as const;
export type AccionAuditoria = (typeof ACCIONES_AUDITORIA)[number];
