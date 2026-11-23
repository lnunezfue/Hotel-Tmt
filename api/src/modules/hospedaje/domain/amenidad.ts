/** Dibujos de comodidades que conoce el cliente (web/src/features/hospedaje/iconos-amenidad.tsx). */
export const ICONOS_AMENIDAD = [
  'aire', 'wifi', 'tv', 'ducha', 'bano', 'frigobar', 'caja_fuerte', 'calefaccion', 'balcon', 'jacuzzi',
  'escritorio', 'accesible', 'vista', 'cocina', 'estacionamiento', 'mascotas', 'desayuno', 'estrella',
] as const;
export type IconoAmenidad = (typeof ICONOS_AMENIDAD)[number];

export const esIconoAmenidad = (v: string): v is IconoAmenidad => (ICONOS_AMENIDAD as readonly string[]).includes(v);

/** "Vista al mar" → "VISTA_AL_MAR": código estable a partir del nombre. */
export function codigoAmenidad(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}
