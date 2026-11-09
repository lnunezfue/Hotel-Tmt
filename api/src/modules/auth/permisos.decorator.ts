import { SetMetadata } from '@nestjs/common';

export const PERMISO_KEY = 'permiso';
export const PUBLICO_KEY = 'publico';
/** Exige un permiso de la tabla `permiso` (rol_permiso). La verificación ocurre siempre en el servidor (RNF-15). */
export const RequierePermiso = (codigo: string) => SetMetadata(PERMISO_KEY, codigo);
/** Marca un endpoint como accesible sin sesión (login, health). */
export const Publico = () => SetMetadata(PUBLICO_KEY, true);
export const CLAVE_TEMPORAL_KEY = 'claveTemporal';
/** Ruta disponible aunque el usuario tenga una contraseña temporal pendiente de cambio (S-03 §4.4). */
export const PermitidoConClaveTemporal = () => SetMetadata(CLAVE_TEMPORAL_KEY, true);
