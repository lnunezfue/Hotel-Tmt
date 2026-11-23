import type { Estado } from '../../lib/api';
import type { Lado } from './plano';

/**
 * Dibujos vistos desde arriba para el plano del hotel: habitaciones con camas, baño, puerta y ventana, y los
 * elementos del piso. Escala: 100 unidades por celda. Los textos (número, huésped) van en HTML encima.
 */

export const PISO_ESTADO: Record<Estado, string> = {
  DESOCUPADA: '#e7f4e8',
  RESERVADA: '#e2eefb',
  CONFIRMADA: '#e7e9f7',
  OCUPADA: '#fbe5e5',
  LIMPIEZA: '#fbf1d9',
  MANTENIMIENTO: '#efe8e4',
};
const PISO_NEUTRO = '#f6efe4';
const MURO = '#2b3a55';
const MADERA = '#d8c3a0';

type Cama = 'individual' | 'dos' | 'matrimonial' | 'king';

/** Qué cama dibujar según el tipo (por nombre si es conocido, si no por capacidad). */
export function camaPara(tipo: string, adultos: number): Cama {
  const t = tipo.toLowerCase();
  if (t.includes('suite')) return 'king';
  if (t.includes('matrimonial') || t.includes('queen')) return 'matrimonial';
  if (t.includes('doble') || t.includes('twin')) return 'dos';
  if (t.includes('simple') || t.includes('individual')) return 'individual';
  return adultos >= 3 ? 'king' : adultos === 2 ? 'matrimonial' : 'individual';
}

function Camita({ x, y, w, l, almohadas = 1, manta = '#c9d3ee' }: { x: number; y: number; w: number; l: number; almohadas?: number; manta?: string }) {
  const pw = (w - 10 - (almohadas - 1) * 4) / almohadas;
  return (
    <g>
      <rect x={x} y={y} width={w} height={l} rx={7} fill="#fff" stroke={MURO} strokeWidth={2.5} />
      <rect x={x - 2} y={y - 5} width={w + 4} height={8} rx={3} fill={MADERA} stroke={MURO} strokeWidth={2} />
      {Array.from({ length: almohadas }, (_, i) => (
        <rect key={i} x={x + 5 + i * (pw + 4)} y={y + 6} width={pw} height={l * 0.17} rx={5} fill="#fff" stroke={MURO} strokeWidth={1.6} />
      ))}
      <path d={`M${x} ${y + l * 0.36} h${w} v${l * 0.64 - 7} a7 7 0 0 1 -7 7 h${-(w - 14)} a7 7 0 0 1 -7 -7 z`} fill={manta} stroke={MURO} strokeWidth={2} />
      <path d={`M${x} ${y + l * 0.44} h${w}`} stroke="#fff" strokeWidth={3} opacity={0.7} />
    </g>
  );
}

const Velador = ({ x, y }: { x: number; y: number }) => (
  <g>
    <rect x={x} y={y} width={20} height={20} rx={3} fill={MADERA} stroke={MURO} strokeWidth={1.8} />
    <circle cx={x + 10} cy={y + 10} r={4.5} fill="#ffe9a8" stroke={MURO} strokeWidth={1.2} />
  </g>
);

/** Muebles en un marco local de W × H con la puerta en el muro de abajo. */
function Muebles({ W, H, cama, amenidades }: { W: number; H: number; cama: Cama; amenidades: string[] }) {
  const tiene = (c: string) => amenidades.includes(c);
  const bw = Math.min(W * 0.34, 110); // baño
  const bh = Math.min(H * 0.42, 85);
  const s = Math.min(1, W / 300, (H - 10) / 190); // escala de muebles en cuartos chicos
  const largo = 118 * s;
  const yCama = 16;
  const centro = bw + (W - bw) / 2;
  const camas: React.ReactNode[] = [];
  if (cama === 'individual') camas.push(<Camita key="c" x={centro - 34 * s} y={yCama} w={68 * s} l={largo} />);
  if (cama === 'dos') {
    const w = 56 * s;
    camas.push(<Camita key="a" x={centro - w - 12 * s} y={yCama} w={w} l={largo} />, <Camita key="b" x={centro + 12 * s} y={yCama} w={w} l={largo} />);
  }
  if (cama === 'matrimonial' || cama === 'king') {
    const w = (cama === 'king' ? 128 : 104) * s;
    camas.push(
      <Camita key="m" x={centro - w / 2} y={yCama} w={w} l={largo * (cama === 'king' ? 1.06 : 1)} almohadas={2} manta={cama === 'king' ? '#e9d5a8' : '#c9d3ee'} />,
      <Velador key="v1" x={centro - w / 2 - 26 * s} y={yCama + 2} />,
      <Velador key="v2" x={centro + w / 2 + 6 * s} y={yCama + 2} />,
    );
  }
  return (
    <g>
      {/* Baño en la esquina de la puerta */}
      <g>
        <rect x={0} y={H - bh} width={bw} height={bh} fill="url(#azulejo)" stroke={MURO} strokeWidth={3} />
        <ellipse cx={bw * 0.3} cy={H - bh * 0.42} rx={Math.min(11, bw * 0.12)} ry={Math.min(14, bh * 0.18)} fill="#fff" stroke={MURO} strokeWidth={1.8} />
        <rect x={bw * 0.3 - 9} y={H - bh + 5} width={18} height={9} rx={2} fill="#fff" stroke={MURO} strokeWidth={1.5} />
        {tiene('AGUA_CALIENTE') || tiene('JACUZZI') ? (
          <g>
            <rect x={bw * 0.58} y={H - bh + 6} width={bw * 0.36} height={bh * 0.55} rx={4} fill="#d6ecf7" stroke={MURO} strokeWidth={1.5} />
            <circle cx={bw * 0.76} cy={H - bh + 6 + bh * 0.27} r={3} fill={MURO} />
          </g>
        ) : (
          <rect x={bw * 0.6} y={H - bh + 8} width={bw * 0.3} height={16} rx={5} fill="#fff" stroke={MURO} strokeWidth={1.5} />
        )}
      </g>
      {camas}
      {tiene('JACUZZI') && W - bw > 150 && (
        <g>
          <rect x={W - 70} y={H - 72} width={58} height={58} rx={29} fill="#cfe9f5" stroke={MURO} strokeWidth={2} />
          <circle cx={W - 41} cy={H - 43} r={18} fill="none" stroke="#7fbfdc" strokeWidth={2} strokeDasharray="4 5" />
        </g>
      )}
      {tiene('ESCRITORIO') && !tiene('JACUZZI') && (
        <g>
          <rect x={W - 26} y={yCama + largo * 0.2} width={18} height={56} rx={2} fill={MADERA} stroke={MURO} strokeWidth={1.8} />
          <circle cx={W - 38} cy={yCama + largo * 0.2 + 28} r={8} fill="#fff" stroke={MURO} strokeWidth={1.5} />
        </g>
      )}
      {tiene('TV') && <rect x={W - 70 - (tiene('JACUZZI') ? 70 : 0)} y={H - 12} width={46} height={5} rx={2} fill={MURO} />}
      {tiene('FRIGOBAR') && <rect x={bw + 70} y={H - 32} width={22} height={22} rx={2} fill="#fff" stroke={MURO} strokeWidth={1.8} />}
      {tiene('BALCON') && (
        <g>
          <path d={`M${W * 0.28} 3 h${W * 0.44}`} stroke="#8fc6e8" strokeWidth={7} />
          <path d={`M${W * 0.26} -10 v10 M${W * 0.36} -10 v10 M${W * 0.46} -10 v10 M${W * 0.56} -10 v10 M${W * 0.66} -10 v10 M${W * 0.74} -10 v10`} stroke={MURO} strokeWidth={1.4} />
        </g>
      )}
      {/* Ventana */}
      {!tiene('BALCON') && <path d={`M${W * 0.34} 2 h${W * 0.32}`} stroke="#8fc6e8" strokeWidth={6} />}
      {/* Puerta: hueco en el muro y arco de apertura */}
      <g>
        <path d={`M${bw + 8} ${H} h52`} stroke="#fff" strokeWidth={8} />
        <path d={`M${bw + 8} ${H} v-50`} stroke={MURO} strokeWidth={2.5} />
        <path d={`M${bw + 8} ${H - 50} a50 50 0 0 1 50 50`} fill="none" stroke={MURO} strokeWidth={1.2} strokeDasharray="4 4" />
      </g>
    </g>
  );
}

/** Habitación vista desde arriba, rotada para que la puerta dé al pasillo. */
export function DibujoHabitacion({
  ancho,
  alto,
  tipo,
  adultos,
  amenidades,
  estado,
  lado,
}: {
  ancho: number;
  alto: number;
  tipo: string;
  adultos: number;
  amenidades: string[];
  estado: Estado | null;
  lado: Lado;
}) {
  const w = ancho * 100;
  const h = alto * 100;
  const m = 5;
  const vertical = lado === 'izquierda' || lado === 'derecha';
  const W = (vertical ? h : w) - m * 2;
  const H = (vertical ? w : h) - m * 2;
  const transform =
    lado === 'abajo'
      ? `translate(${m} ${m})`
      : lado === 'arriba'
        ? `translate(${w - m} ${h - m}) rotate(180)`
        : lado === 'derecha'
          ? `translate(${w - m} ${m}) rotate(90)`
          : `translate(${m} ${h - m}) rotate(-90)`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <pattern id="azulejo" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#eef4f8" />
          <path d="M12 0V12M0 12H12" stroke="#c9d8e2" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x={m} y={m} width={w - m * 2} height={h - m * 2} rx={6} fill={estado ? PISO_ESTADO[estado] : PISO_NEUTRO} stroke={MURO} strokeWidth={5} />
      <g transform={transform}>
        <Muebles W={W} H={H} cama={camaPara(tipo, adultos)} amenidades={amenidades} />
      </g>
    </svg>
  );
}

export type TipoElemento = 'PASILLO' | 'ESCALERA' | 'ASCENSOR' | 'RECEPCION' | 'AREA_COMUN' | 'BANO_COMUN';

export const ELEMENTOS: Record<TipoElemento, { nombre: string; tamano: { ancho: number; alto: number } }> = {
  PASILLO: { nombre: 'Pasillo', tamano: { ancho: 4, alto: 1 } },
  ESCALERA: { nombre: 'Escalera', tamano: { ancho: 1, alto: 1 } },
  ASCENSOR: { nombre: 'Ascensor', tamano: { ancho: 1, alto: 1 } },
  RECEPCION: { nombre: 'Recepción', tamano: { ancho: 2, alto: 1 } },
  AREA_COMUN: { nombre: 'Área común', tamano: { ancho: 2, alto: 2 } },
  BANO_COMUN: { nombre: 'Baño común', tamano: { ancho: 1, alto: 1 } },
};

export function DibujoElemento({ tipo, ancho, alto }: { tipo: TipoElemento; ancho: number; alto: number }) {
  const w = ancho * 100;
  const h = alto * 100;
  const horizontal = w >= h;
  const cx = w / 2;
  const cy = h / 2;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" aria-hidden>
      {tipo === 'PASILLO' && (
        <g>
          <rect x={0} y={0} width={w} height={h} fill="#e6eaf0" />
          <path d={horizontal ? `M10 ${cy} H${w - 10}` : `M${cx} 10 V${h - 10}`} stroke="#b7c0cd" strokeWidth={4} strokeDasharray="18 14" />
        </g>
      )}
      {tipo === 'ESCALERA' && (
        <g>
          <rect x={4} y={4} width={w - 8} height={h - 8} rx={4} fill="#dfe3ea" stroke={MURO} strokeWidth={3} />
          {Array.from({ length: 7 }, (_, i) => (
            <path key={i} d={horizontal ? `M${12 + (i * (w - 24)) / 6} 10 V${h - 10}` : `M10 ${12 + (i * (h - 24)) / 6} H${w - 10}`} stroke={MURO} strokeWidth={2} />
          ))}
          <path d={horizontal ? `M18 ${cy} H${w - 24} m-10 -10 l10 10 l-10 10` : `M${cx} ${h - 18} V24 m-10 10 l10 -10 l10 10`} fill="none" stroke="#c26a00" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {tipo === 'ASCENSOR' && (
        <g>
          <rect x={6} y={6} width={w - 12} height={h - 12} rx={6} fill="#d9dee7" stroke={MURO} strokeWidth={3} />
          <path d={`M${cx} 14 V${h - 14}`} stroke={MURO} strokeWidth={2} />
          <path d={`M${cx - 26} ${cy - 6} l12 -16 l12 16 z M${cx + 14} ${cy + 6} l12 16 l12 -16 z`} fill="#c26a00" />
        </g>
      )}
      {tipo === 'RECEPCION' && (
        <g>
          <rect x={0} y={0} width={w} height={h} fill="#efe6d8" />
          <path d={`M14 ${h * 0.35} H${w - 14} V${h - 14}`} fill="none" stroke={MADERA} strokeWidth={18} strokeLinejoin="round" />
          <path d={`M14 ${h * 0.35} H${w - 14} V${h - 14}`} fill="none" stroke={MURO} strokeWidth={2} />
          <circle cx={w * 0.3} cy={h * 0.35} r={7} fill="#ffd36b" stroke={MURO} strokeWidth={1.5} />
        </g>
      )}
      {tipo === 'AREA_COMUN' && (
        <g>
          <rect x={0} y={0} width={w} height={h} fill="#eaf2e6" />
          <rect x={w * 0.2} y={h * 0.62} width={w * 0.6} height={h * 0.2} rx={10} fill="#a5b8d6" stroke={MURO} strokeWidth={2} />
          <rect x={w * 0.35} y={h * 0.3} width={w * 0.3} height={h * 0.22} rx={8} fill={MADERA} stroke={MURO} strokeWidth={2} />
          {[[0.14, 0.18], [0.86, 0.18], [0.14, 0.82], [0.86, 0.82]].map(([px, py], i) => (
            <g key={i}>
              <circle cx={w * px} cy={h * py} r={13} fill="#7cb46b" stroke="#4f7d44" strokeWidth={2} />
              <circle cx={w * px - 4} cy={h * py - 4} r={4} fill="#a6d68f" />
            </g>
          ))}
        </g>
      )}
      {tipo === 'BANO_COMUN' && (
        <g>
          <rect x={4} y={4} width={w - 8} height={h - 8} rx={4} fill="url(#azulejo-e)" stroke={MURO} strokeWidth={3} />
          <defs>
            <pattern id="azulejo-e" width="12" height="12" patternUnits="userSpaceOnUse">
              <rect width="12" height="12" fill="#eef4f8" />
              <path d="M12 0V12M0 12H12" stroke="#c9d8e2" strokeWidth="1" />
            </pattern>
          </defs>
          <ellipse cx={cx} cy={cy + 8} rx={14} ry={18} fill="#fff" stroke={MURO} strokeWidth={2} />
          <rect x={cx - 12} y={cy - 26} width={24} height={11} rx={3} fill="#fff" stroke={MURO} strokeWidth={1.8} />
        </g>
      )}
    </svg>
  );
}

/** Fachada del edificio: un piso por banda con una ventana por habitación, coloreada por estado. */
export const VENTANA_ESTADO: Record<Estado, string> = {
  DESOCUPADA: '#8fd19e',
  RESERVADA: '#7fb2ec',
  CONFIRMADA: '#9aa5e6',
  OCUPADA: '#f08a8a',
  LIMPIEZA: '#f2c96b',
  MANTENIMIENTO: '#b59c90',
};
