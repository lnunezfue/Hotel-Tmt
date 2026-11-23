import type { ReactNode } from 'react';

/**
 * Dibujos de las comodidades (24 × 24, trazo). La lista coincide con ICONOS_AMENIDAD de la API
 * (api/src/modules/hospedaje/domain/amenidad.ts): una comodidad nueva elige uno de estos dibujos.
 */
export const DIBUJOS_AMENIDAD: Record<string, ReactNode> = {
  aire: (
    <>
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
      <path d="M10 4.5 12 6l2-1.5M10 19.5 12 18l2 1.5M4.5 10.5 6.6 9.8 6 7.5M19.5 13.5l-2.1.7.6 2.3M4.5 13.5l2.1.7-.6 2.3M19.5 10.5l-2.1-.7.6-2.3" />
    </>
  ),
  wifi: (
    <>
      <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0" />
      <circle cx="12" cy="19.2" r="1.1" fill="currentColor" />
    </>
  ),
  tv: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="1.5" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  ducha: (
    <>
      <path d="M5 21V8a4 4 0 0 1 4-4h1a4 4 0 0 1 4 4" />
      <path d="M10 8h8l-1 2h-6z" />
      <path d="M12 13v1.5M15 13v1.5M18 13v1.5M13.5 16.5V18M16.5 16.5V18" />
    </>
  ),
  bano: (
    <>
      <path d="M6 4h5v6H6z" />
      <path d="M5 10h14a0 0 0 0 1 0 0 7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6z" />
      <path d="M10 17l-1 4h6l-1-4" />
    </>
  ),
  frigobar: (
    <>
      <rect x="6" y="3" width="12" height="18" rx="1.5" />
      <path d="M6 10h12M9 6v2M9 13v3" />
    </>
  ),
  caja_fuerte: (
    <>
      <rect x="3.5" y="4" width="17" height="15" rx="1.5" />
      <circle cx="12" cy="11.5" r="3.5" />
      <path d="M12 8v1.5M12 13.5V15M8.5 11.5H10M14 11.5h1.5M6 19v2M18 19v2" />
    </>
  ),
  calefaccion: (
    <>
      <path d="M7 4c-2 2.5 2 4.5 0 7s2 4.5 0 7M12 4c-2 2.5 2 4.5 0 7s2 4.5 0 7M17 4c-2 2.5 2 4.5 0 7s2 4.5 0 7" />
      <path d="M4 21h16" />
    </>
  ),
  balcon: (
    <>
      <path d="M3 11h18M3 20h18M5 11v9M9 11v9M13 11v9M17 11v9M21 11v9" />
      <path d="M8 11V5a4 4 0 0 1 8 0v6" />
    </>
  ),
  jacuzzi: (
    <>
      <path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z" />
      <path d="M6 19l-1 2M18 19l1 2M5 12V6a2 2 0 0 1 4 0" />
      <circle cx="12" cy="7" r="1" />
      <circle cx="15.5" cy="5" r="1.2" />
      <circle cx="16" cy="9" r=".8" />
    </>
  ),
  escritorio: (
    <>
      <path d="M3 13h18M5 13v8M19 13v8M14 13v4h5" />
      <path d="M8 13V9l3-4M11 5l2 1.5-1.5 2" />
    </>
  ),
  accesible: (
    <>
      <circle cx="11" cy="4" r="1.6" />
      <path d="M11 7v6h5l2 5" />
      <path d="M11 9.5h4" />
      <path d="M8.5 11a5.5 5.5 0 1 0 6.9 7" />
    </>
  ),
  vista: (
    <>
      <path d="M2 19l6-8 4 5 3-3 7 6z" />
      <circle cx="17" cy="6" r="2.5" />
    </>
  ),
  cocina: (
    <>
      <path d="M4 10h16v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z" />
      <path d="M2 12h2M20 12h2M9 7c0-1.5 1-1.5 1-3M14 7c0-1.5 1-1.5 1-3" />
    </>
  ),
  estacionamiento: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M10 17V7h3a3 3 0 0 1 0 6h-3" />
    </>
  ),
  mascotas: (
    <>
      <ellipse cx="12" cy="16" rx="4" ry="3.5" />
      <circle cx="6" cy="10.5" r="1.7" />
      <circle cx="9.5" cy="6.5" r="1.7" />
      <circle cx="14.5" cy="6.5" r="1.7" />
      <circle cx="18" cy="10.5" r="1.7" />
    </>
  ),
  desayuno: (
    <>
      <path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z" />
      <path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M3 21h14M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3" />
    </>
  ),
  estrella: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
};

export const ICONOS_DISPONIBLES = Object.keys(DIBUJOS_AMENIDAD);

export function IconoAmenidad({ icono, className = 'h-4 w-4', titulo }: { icono: string; className?: string; titulo?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" role={titulo ? 'img' : undefined} aria-hidden={titulo ? undefined : true}>
      {titulo && <title>{titulo}</title>}
      {DIBUJOS_AMENIDAD[icono] ?? DIBUJOS_AMENIDAD.estrella}
    </svg>
  );
}
