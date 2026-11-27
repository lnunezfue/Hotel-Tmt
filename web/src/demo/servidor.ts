/**
 * API SIMULADA para la demostración publicada en la web (build con VITE_DEMO=1). No forma parte del sistema:
 * responde en el navegador con una foto de la API real (datos.json, tomada del seed) y reproduce las reglas
 * principales para recorrer el proceso completo del hotel real: caja, check-in por horas con pago adelantado,
 * extensión, check-out, limpieza de 30 min, reservas sin adelanto y cierre de caja. Los cambios se guardan solo en
 * este navegador.
 */
import { ApiError } from '../lib/api/cliente';
import type { Amenidad, Cliente, Comprobante, Disponibilidad, ElementoPlano, Estado, Estancia, MetodoPago, Operacion, PisoPlano, Producto, Reserva, SesionCaja } from '../lib/api/tipos';
import { horaConDia, MARGEN_MINUTO_MS, salidaPrevista } from '../features/hospedaje/operacion';
import { cabe, distribucionInicial } from '../features/hospedaje/plano';
import { diasEntre, fechaDe, hoyLima, sumarDias } from '../features/reservas/fechas';
import foto from './datos.json';

const CLAVE = 'hotel-demo-v4';
const CLAVE_DEMO = 'Hotel2026!';
const TRANSICIONES: Record<Estado, Estado[]> = {
  DESOCUPADA: ['RESERVADA', 'OCUPADA', 'MANTENIMIENTO', 'LIMPIEZA'],
  RESERVADA: ['CONFIRMADA', 'OCUPADA', 'DESOCUPADA'],
  CONFIRMADA: ['OCUPADA', 'DESOCUPADA'],
  OCUPADA: ['LIMPIEZA'],
  LIMPIEZA: ['DESOCUPADA', 'MANTENIMIENTO'],
  MANTENIMIENTO: ['DESOCUPADA'],
};

/** Pasos del recorrido guiado; el servidor los marca cuando ocurren. */
export type PasoRecorrido = 'caja' | 'checkin' | 'extension' | 'checkout' | 'limpieza' | 'reserva' | 'cierre';

interface EstanciaDemo {
  id: number;
  reservaId: number | null;
  checkin: string;
  salidaPrevista: string;
  turno: string;
  horasTurno: number;
  cantidad: number;
  precio: string;
  canal: string;
  comision: string;
  procedencia: string | null;
  destino?: string | null;
  motivoViaje?: string | null;
  huespedes: Estancia['huespedes'];
  cargos: Estancia['cargos'];
  /** Lo ya cobrado: comprobante, turnos y cargos que llevó (pago adelantado). */
  pagos: Array<{ id: number; numero: string; total: string; turnos: number; cargos: number[] }>;
}
interface Hab {
  id: number;
  pisoId: number;
  numero: string;
  descripcion: string | null;
  tipoId: number;
  estado: Estado;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  amenidades: string[];
  activo: boolean;
  estancia: EstanciaDemo | null;
  /** Desde cuándo está en su estado (cuenta el tiempo de limpieza). */
  estadoDesde: string;
  historial: Array<{ id: number; fecha: string; motivo: string | null; usuario: string | null; desde: Estado | null; hacia: Estado }>;
}
interface Piso { id: number; numero: number; nombre: string; columnas: number; filas: number; elementos: ElementoPlano[] }
interface Tipo { id: number; nombre: string; adultos: number; ninos: number }
interface Movimiento { id: number; fecha: string; codigo: string; concepto: string; tipo: 'INGRESO' | 'EGRESO'; metodoId: number; monto: string; descripcion: string | null; reserva: string | null; usuario: string }
interface Datos {
  version: number;
  usuario: string | null;
  operacion: Operacion;
  pisos: Piso[];
  habs: Hab[];
  tipos: Tipo[];
  amenidades: Amenidad[];
  reservas: Reserva[];
  clientes: Cliente[];
  caja: null | { id: number; apertura: string; montoApertura: string; usuario: string; movimientos: Movimiento[] };
  ultimoCierre: null | { id: number; cierre: string; esperado: string; declarado: string; diferencia: string; usuario: string };
  comprobantes: Comprobante[];
  correlativos: Record<string, number>;
  recorrido: Partial<Record<PasoRecorrido, boolean>>;
  seq: number;
}

type Foto = typeof foto & { rutas: Record<string, unknown>; estancias: Estancia[] };
const F = foto as unknown as Foto;
const R = <T,>(ruta: string) => F.rutas[ruta] as T;
const DIA_MS = 86_400_000;
const cent = (s: string | number) => Math.round(Number(s) * 100);
const soles = (c: number) => (c / 100).toFixed(2);

/** Corre las fechas de la foto a hoy: estancias y reservas por horas por el tiempo exacto, las de noche por días enteros. */
function inicial(): Datos {
  const msDesde = Date.now() - Date.parse(F.capturado);
  const diasDesde = diasEntre(F.hoy, hoyLima());
  const mover = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
  const plano = R<PisoPlano[]>('/hospedaje/plano');
  const estancias = new Map(F.estancias.map((e) => [e.habitacion.id, e]));
  const canales = R<Array<{ nombre: string; comisionPorcentaje: string }>>('/hospedaje/config/canales');
  const tipos = R<Array<{ id: number; nombre: string; capacidadAdultos: number; capacidadNinos: number }>>('/hospedaje/config/tipos-habitacion');
  const enTablero = new Map(R<{ pisos: Array<{ habitaciones: Array<{ id: number; estadoDesde?: string | null }> }> }>('/hospedaje/tablero').pisos.flatMap((p) => p.habitaciones).map((h) => [h.id, h.estadoDesde]));
  const pagados = F.estancias.flatMap((e) => e.cuenta.comprobantes);
  const operacionFoto = R<Operacion>('/hospedaje/operacion');
  return {
    version: 4,
    usuario: null,
    operacion: operacionFoto,
    pisos: plano.map((p) => ({ id: p.id, numero: p.numero, nombre: p.nombre, columnas: p.columnas, filas: p.filas, elementos: p.elementos })),
    habs: plano.flatMap((p) =>
      p.habitaciones.map((h) => {
        const e = estancias.get(h.id);
        return {
          id: h.id, pisoId: p.id, numero: h.numero, descripcion: h.descripcion, tipoId: h.tipo.id, estado: h.estado,
          x: h.x, y: h.y, ancho: h.ancho, alto: h.alto, amenidades: h.amenidades, activo: true,
          estancia: e
            ? {
                id: e.id, reservaId: null, checkin: mover(e.checkin, msDesde),
                // La noche sale a la hora fija (9:00): se recalcula desde el check-in corrido, no se corre
                salidaPrevista: e.horasTurno === 24 && operacionFoto.horaSalidaNoche
                  ? salidaPrevista(new Date(mover(e.checkin, msDesde)), 24, e.cantidad, operacionFoto).salida.toISOString()
                  : mover(e.salidaPrevista, msDesde), turno: e.turno, horasTurno: e.horasTurno,
                cantidad: e.cantidad, precio: e.precio, canal: e.canal, comision: canales.find((c) => c.nombre === e.canal)?.comisionPorcentaje ?? '0.00',
                procedencia: e.procedencia, huespedes: e.huespedes, cargos: [],
                pagos: e.cuenta.comprobantes.map((c) => ({ ...c, turnos: e.cantidad, cargos: [] })),
              }
            : null,
          estadoDesde: mover(enTablero.get(h.id) ?? F.capturado, msDesde),
          historial: [],
        };
      }),
    ),
    tipos: tipos.map((t) => ({ id: t.id, nombre: t.nombre, adultos: t.capacidadAdultos, ninos: t.capacidadNinos })),
    amenidades: R<Amenidad[]>('/hospedaje/amenidades'),
    reservas: R<Reserva[]>('/reservas').map((r) => {
      const ms = r.habitaciones[0]?.horasTurno === 24 ? diasDesde * DIA_MS : msDesde;
      return { ...r, entrada: mover(r.entrada, ms), salida: mover(r.salida, ms) };
    }),
    clientes: F.clientes as Cliente[],
    caja: null,
    ultimoCierre: null,
    comprobantes: [],
    // Las boletas del pago adelantado de la foto ya usaron sus números
    correlativos: { B001: pagados.filter((c) => c.numero.startsWith('B001')).length },
    recorrido: {},
    seq: 1000,
  };
}

let db: Datos = cargar();

function cargar(): Datos {
  try {
    const t = localStorage.getItem(CLAVE);
    if (t) {
      const d = JSON.parse(t) as Datos;
      if (d.version === 4) return d;
    }
  } catch {
    // almacenamiento no disponible: la demo funciona en memoria
  }
  return inicial();
}
function guardar() {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(db));
  } catch {
    // sin almacenamiento: se pierde al recargar
  }
  window.dispatchEvent(new Event('demo-cambio'));
}

/** Vuelve a la foto original (botón «Reiniciar demo»). */
export function reiniciarDemo() {
  const usuario = db.usuario;
  db = { ...inicial(), usuario };
  guardar();
}
export const progresoRecorrido = () => ({ ...db.recorrido });
const marcar = (p: PasoRecorrido) => {
  db.recorrido[p] = true;
};

const error = (status: number, message: string, codigo?: string): never => {
  throw new ApiError(status, message, codigo);
};
const id = () => ++db.seq;
const tipoDe = (h: Hab) => db.tipos.find((t) => t.id === h.tipoId)!;
const pisoDe = (pisoId: number) => db.pisos.find((p) => p.id === pisoId)!;
const usuarioActual = () => (db.usuario === 'recepcion1' ? F.me.recepcion1 : F.me.admin);
const metodos = () => R<MetodoPago[]>('/caja/metodos-pago');
const metodo = (idM: number) => metodos().find((m) => m.id === idM);
const turnos = () => R<Array<{ id: number; nombre: string; duracion_horas: number }>>('/hospedaje/turnos');
const canales = () => R<Array<{ id: number; nombre: string; esOta: boolean; comisionPorcentaje: string }>>('/hospedaje/config/canales');

function alerta(salida: string): 'VENCIDA' | 'POR_VENCER' | null {
  const min = (Date.parse(salida) - Date.now()) / 60000;
  return min < 0 ? 'VENCIDA' : min <= 30 ? 'POR_VENCER' : null;
}

function rango(llegada: string, cantidad: number, horas: number, hora?: string): { entrada: string; salida: string } {
  if (db.operacion.configurada) {
    const [hh, mm] = (hora ?? '14:00').split(':').map(Number);
    const entrada = new Date(Date.parse(`${llegada}T00:00:00Z`) + (hh + 5) * 3_600_000 + mm * 60_000);
    return { entrada: entrada.toISOString(), salida: salidaSegunOperacion(entrada, horas, cantidad).toISOString() };
  }
  if (horas === 24) {
    return { entrada: new Date(Date.parse(`${llegada}T19:00:00Z`)).toISOString(), salida: new Date(Date.parse(`${sumarDias(llegada, cantidad)}T17:00:00Z`)).toISOString() };
  }
  const [hh, mm] = (hora ?? '14:00').split(':').map(Number);
  const entrada = Date.parse(`${llegada}T00:00:00Z`) + (hh + 5) * 3_600_000 + mm * 60_000;
  return { entrada: new Date(entrada).toISOString(), salida: new Date(entrada + horas * cantidad * 3_600_000).toISOString() };
}
/** Salida con la operación de la sucursal (noche a las 9:00, tope por franja); lanza 400 si pasa la hora máxima. */
function salidaSegunOperacion(desde: Date, horas: number, cantidad: number): Date {
  const p = salidaPrevista(desde, horas, cantidad, db.operacion);
  if (p.excede) {
    return error(400, `Con ingreso en la franja «${p.franja}» la salida máxima es a las ${horaConDia(p.maxima!, desde).replace(' de mañana', ' del día siguiente')}. ` +
      (p.caben ? `Caben ${p.caben} ${p.caben === 1 ? 'turno' : 'turnos'} de ${horas} h, o vende la noche completa.` : `No cabe un turno de ${horas} h; elige uno más corto o la noche completa.`));
  }
  return p.salida;
}
const cruza = (a: { entrada: string; salida: string }, b: { entrada: string; salida: string }) => a.entrada < b.salida && b.entrada < a.salida;
const abiertas = (r: Reserva) => ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'].includes(r.estado);

function cambiarEstado(h: Hab, hacia: Estado, motivo: string | null) {
  if (h.estado === 'LIMPIEZA' && hacia === 'DESOCUPADA' && db.recorrido.checkout) marcar('limpieza');
  h.historial.unshift({ id: id(), fecha: new Date().toISOString(), motivo, usuario: usuarioActual().nombre, desde: h.estado, hacia });
  h.estado = hacia;
  h.estadoDesde = new Date().toISOString();
}

function precio(tipoId: number, canalId: number, turnoId: number): string | null {
  const t = R<{ celdas: Array<{ tipoId: number; canalId: number; turnoId: number; vigente: { precio: string } | null }> }>('/hospedaje/tarifas');
  return t.celdas.find((c) => c.tipoId === tipoId && c.canalId === canalId && c.turnoId === turnoId)?.vigente?.precio ?? null;
}

// ── Caja ────────────────────────────────────────────────────────

function sesionCaja(): SesionCaja | null {
  const c = db.caja;
  if (!c) return null;
  const porMetodo = new Map<number, { ingresos: number; egresos: number }>();
  let efectivo = cent(c.montoApertura);
  for (const m of c.movimientos) {
    const f = porMetodo.get(m.metodoId) ?? { ingresos: 0, egresos: 0 };
    if (m.tipo === 'INGRESO') f.ingresos += cent(m.monto);
    else f.egresos += cent(m.monto);
    porMetodo.set(m.metodoId, f);
    if (metodo(m.metodoId)?.es_efectivo) efectivo += (m.tipo === 'INGRESO' ? 1 : -1) * cent(m.monto);
  }
  return {
    id: c.id, caja: { id: 1, nombre: 'Recepción 1' }, usuario: c.usuario, apertura: c.apertura, montoApertura: c.montoApertura, estado: 'ABIERTA',
    efectivoEsperado: soles(efectivo),
    porMetodo: [...porMetodo.entries()].map(([idM, f]) => ({ codigo: metodo(idM)!.codigo, metodo: metodo(idM)!.descripcion, efectivo: metodo(idM)!.es_efectivo, ingresos: soles(f.ingresos), egresos: soles(f.egresos) })),
    movimientos: [...c.movimientos].reverse().map((m) => ({ id: m.id, fecha: m.fecha, concepto: m.concepto, codigo: m.codigo, tipo: m.tipo, metodo: metodo(m.metodoId)!.descripcion, monto: m.monto, descripcion: m.descripcion, reserva: m.reserva, usuario: m.usuario })),
  };
}
const CONCEPTOS: Record<string, [string, 'INGRESO' | 'EGRESO']> = {
  VENTA: ['Cobro de una venta', 'INGRESO'],
  ADELANTO_RESERVA: ['Adelanto de una reserva', 'INGRESO'],
  INGRESO_FONDOS: ['Ingreso de fondos', 'INGRESO'],
  GASTO: ['Gasto menor', 'EGRESO'],
  RETIRO: ['Retiro de efectivo', 'EGRESO'],
};
function movimientoCaja(codigo: string, metodoId: number, monto: string, descripcion: string | null, reserva: string | null = null) {
  if (!db.caja) return error(409, 'La caja está cerrada. Ábrela en «Caja» para registrar cobros.', 'CAJA_CERRADA');
  const [concepto, tipo] = CONCEPTOS[codigo];
  db.caja.movimientos.push({ id: id(), fecha: new Date().toISOString(), codigo, concepto, tipo, metodoId, monto, descripcion, reserva, usuario: db.usuario ?? 'admin' });
}

// ── Estadía y cobro ─────────────────────────────────────────────

const grupoDe = (h: Hab): Hab[] => (h.estancia?.reservaId ? db.habs.filter((x) => x.estancia?.reservaId === h.estancia!.reservaId) : [h]);

/** Turnos que suma una salida tardía (30 min de tolerancia), como la API (RF-RES-12). */
function turnosTarde(salida: string, horas: number): number {
  const exceso = Date.now() - Date.parse(salida) - 30 * 60_000;
  return exceso <= 0 ? 0 : Math.ceil((exceso + 30 * 60_000) / (horas * 3_600_000));
}

/** Cuenta con lo ya cobrado (pago adelantado): `pendientes` es lo que llevará el próximo comprobante. */
function cuenta(grupo: Hab[]) {
  const lineas: Estancia['cuenta']['lineas'] = [];
  const pendientes: Estancia['cuenta']['lineas'] = [];
  const pagos: EstanciaDemo['pagos'] = [];
  for (const h of grupo) {
    const e = h.estancia!;
    const extra = turnosTarde(e.salidaPrevista, e.horasTurno);
    const n = e.cantidad + extra;
    const unidad = (k: number) => (e.horasTurno === 24 ? `${k} ${k === 1 ? 'noche' : 'noches'}` : `${k} × turno de ${e.horasTurno} h`);
    const base = `Hospedaje hab. ${h.numero} (${tipoDe(h).nombre})`;
    const hosp = (k: number, desc: string) => ({ tipo: 'HOSPEDAJE' as const, descripcion: desc, cantidad: k, precioUnitario: e.precio, total: soles(cent(e.precio) * k), estanciaId: String(e.id) });
    lineas.push(hosp(n, `${base} · ${unidad(n)}${extra ? ` (incluye ${extra} por salida tardía)` : ''}`));
    const cobrados = e.pagos.reduce((acc, p) => acc + p.turnos, 0);
    if (n > cobrados) {
      const k = n - cobrados;
      pendientes.push(hosp(k, `${base} · ${unidad(k)}${cobrados === 0 ? (extra ? ` (incluye ${extra} por salida tardía)` : '') : extra && k <= extra ? ' · salida tardía' : ' · extensión'}`));
    }
    for (const c of e.cargos) {
      const l = { tipo: 'CARGO' as const, descripcion: `${c.descripcion}${grupo.length > 1 ? ` (hab. ${h.numero})` : ''}`, cantidad: c.cantidad, precioUnitario: c.precio, total: c.total, cargoId: String(c.id), estanciaId: String(e.id) };
      lineas.push(l);
      if (!e.pagos.some((p) => p.cargos.includes(c.id))) pendientes.push(l);
    }
    pagos.push(...e.pagos.filter((p) => !pagos.some((x) => x.id === p.id)));
  }
  const total = lineas.reduce((acc, l) => acc + cent(l.total), 0);
  const porCobrar = pendientes.reduce((acc, l) => acc + cent(l.total), 0);
  const cobrado = pagos.reduce((acc, p) => acc + cent(p.total), 0);
  const reserva = db.reservas.find((r) => r.id === grupo[0].estancia!.reservaId) ?? null;
  // El adelanto de la reserva va en el primer comprobante
  const adelanto = reserva && pagos.length === 0 ? Math.min(cent(reserva.adelanto), porCobrar) : 0;
  const hospedaje = lineas.filter((l) => l.tipo === 'HOSPEDAJE').reduce((acc, l) => acc + cent(l.total), 0);
  const porcentaje = reserva ? reserva.comision.porcentaje : grupo[0].estancia!.comision;
  return {
    lineas, pendientes, total: soles(total), porCobrar: soles(porCobrar), cobrado: soles(cobrado), comprobantes: pagos.map(({ id: i, numero, total: t }) => ({ id: i, numero, total: t })),
    adelanto: soles(adelanto), saldo: soles(porCobrar - adelanto),
    comision: { porcentaje, monto: soles(Math.round((hospedaje * Number(porcentaje)) / 100)) },
    reserva: reserva ? { id: reserva.id, codigo: reserva.codigo } : null,
  };
}

/** Libera las habitaciones del grupo: pasan a limpieza y la reserva termina. */
function cerrarGrupo(grupo: Hab[], motivo: string) {
  const reservaId = grupo[0].estancia?.reservaId;
  for (const g of grupo) {
    g.estancia = null;
    cambiarEstado(g, 'LIMPIEZA', motivo);
  }
  const r = db.reservas.find((x) => x.id === reservaId);
  if (r) r.estado = 'FINALIZADA';
  marcar('checkout');
}

function vistaEstancia(h: Hab): Estancia {
  const e = h.estancia;
  if (!e) return error(404, 'La habitación no tiene una estadía en curso');
  const t = tipoDe(h);
  const grupo = grupoDe(h);
  return {
    id: e.id, estado: 'ACTIVA', habitacion: { id: h.id, numero: h.numero, tipo: t.nombre, capacidad: t.adultos + t.ninos }, checkin: e.checkin, salidaPrevista: e.salidaPrevista, checkout: null,
    turno: e.turno, horasTurno: e.horasTurno, cantidad: e.cantidad, precio: e.precio, canal: e.canal, procedencia: e.procedencia, destino: e.destino ?? null, motivoViaje: e.motivoViaje ?? null, placa: null,
    reserva: db.reservas.find((r) => r.id === e.reservaId)?.codigo ?? null, huespedes: e.huespedes, cargos: e.cargos, cuenta: cuenta(grupo),
    grupo: grupo.map((g) => ({ id: g.estancia!.id, habitacion: g.numero })),
  };
}
const habDeEstancia = (idE: number) => db.habs.find((h) => h.estancia?.id === idE) ?? error(404, 'La estadía no existe');

function letras(soles: string): string {
  const U = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
  const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
  const h999 = (n: number) => {
    if (n === 100) return 'CIEN';
    const r = n % 100;
    const p = [C[Math.floor(n / 100)]];
    p.push(r < 30 ? U[r] : r % 10 ? `${D[Math.floor(r / 10)]} Y ${U[r % 10]}` : D[Math.floor(r / 10)]);
    return p.filter(Boolean).join(' ');
  };
  const c = cent(soles);
  const e = Math.floor(c / 100);
  const miles = Math.floor(e / 1000);
  const texto = e === 0 ? 'CERO' : [miles ? (miles === 1 ? 'MIL' : `${h999(miles).replace(/UNO$/, 'UN')} MIL`) : '', h999(e % 1000)].filter(Boolean).join(' ');
  return `${texto} CON ${String(c % 100).padStart(2, '0')}/100 SOLES`;
}

/** Cobra lo pendiente; con `cerrar` además hace el check-out. Con la cuenta pagada, el check-out solo cierra. */
function cobrar(h: Hab, b: Record<string, unknown>, cerrar: boolean) {
  const grupo = grupoDe(h);
  const c = cuenta(grupo);
  if (!c.pendientes.length) {
    if (!cerrar) return error(409, 'La cuenta está pagada: no hay nada por cobrar');
    cerrarGrupo(grupo, `Check-out (pagado: ${c.comprobantes.map((x) => x.numero).join(', ')})`);
    return { cerrada: true, comprobanteId: null, comprobante: null, total: '0.00', descuento: '0.00', vuelto: '0.00' };
  }
  if (!b.tipoComprobante) return error(400, `Hay S/ ${c.saldo} por cobrar: elige el comprobante y el pago`);
  // Descuento global (S-07): en soles o %, sin bajar el total por debajo del adelanto
  const d = b.descuento as { tipo: 'MONTO' | 'PORCENTAJE'; valor: number; motivo: string } | undefined;
  const descCent = d ? (d.tipo === 'MONTO' ? cent(d.valor) : Math.round((cent(c.porCobrar) * d.valor) / 100)) : 0;
  if (d && String(d.motivo ?? '').trim().length < 5) return error(400, 'El motivo del descuento debe tener entre 5 y 250 caracteres');
  if (descCent > cent(c.porCobrar) - cent(c.adelanto)) return error(400, 'El descuento no puede bajar el total por debajo del adelanto');
  const saldo = cent(c.saldo) - descCent;
  const totalFinal = cent(c.porCobrar) - descCent;
  const pagos = (b.pagos as Array<{ metodoPagoId: number; monto: number; referencia?: string | null }>) ?? [];
  const noEf = pagos.filter((p) => !metodo(p.metodoPagoId)?.es_efectivo).reduce((s, p) => s + cent(p.monto), 0);
  const total = pagos.reduce((s, p) => s + cent(p.monto), 0);
  if (noEf > saldo) return error(400, 'Los pagos con tarjeta, Yape o transferencia superan el saldo; el vuelto solo se da en efectivo');
  if (total < saldo) return error(400, `Falta cobrar S/ ${soles(saldo - total)}`);
  if (pagos.length && !db.caja) return error(409, 'La caja está cerrada. Ábrela en «Caja» para registrar cobros.', 'CAJA_CERRADA');
  const tipo = b.tipoComprobante as Comprobante['tipo'];
  const titular = grupo[0].estancia!.huespedes.find((x) => x.titular) ?? grupo[0].estancia!.huespedes[0];
  const cliente = tipo === 'FACTURA' || b.clienteId ? db.clientes.find((x) => x.id === b.clienteId) : { nombre: titular.nombre, documento: titular.documento };
  if (!cliente) return error(400, 'El cliente del comprobante no existe');
  if (tipo === 'FACTURA' && !cliente.documento.startsWith('RUC')) return error(400, 'La factura requiere un cliente con RUC');
  const serie = { BOLETA: 'B001', FACTURA: 'F001', INTERNO: 'I001' }[tipo];
  db.correlativos[serie] = (db.correlativos[serie] ?? 0) + 1;
  const numero = `${serie}-${String(db.correlativos[serie]).padStart(8, '0')}`;
  let vuelto = total - saldo;
  const registrados = pagos.map((p) => {
    if (!metodo(p.metodoPagoId)?.es_efectivo || vuelto === 0) return { ...p, monto: cent(p.monto) };
    const quita = Math.min(cent(p.monto), vuelto);
    vuelto -= quita;
    return { ...p, monto: cent(p.monto) - quita };
  }).filter((p) => p.monto > 0);
  const ahora = new Date();
  const lima = new Date(ahora.getTime() - 5 * 3_600_000).toISOString();
  let gravada = 0;
  for (const l of c.pendientes) gravada += Math.round(cent(l.total) / 1.18);
  gravada -= Math.round(descCent / 1.18);
  const empresa = R<{ ruc: string; razon_social: string; nombre_comercial: string | null }>('/organizacion/empresa');
  const tipoDoc = cliente.documento.split(' ')[0];
  const comp: Comprobante = {
    id: id(), tipo, tipoDescripcion: tipo, numero, fecha: lima.slice(0, 10), hora: lima.slice(11, 19),
    emisor: { ruc: empresa.ruc, razonSocial: empresa.razon_social, nombreComercial: empresa.nombre_comercial, direccion: 'Av. Bolognesi 123, Tacna', sucursal: 'Hotel Centro' },
    cliente: { tipoDoc: { DNI: '1', RUC: '6', CE: '4', PAS: '7' }[tipoDoc] ?? '0', documento: cliente.documento.split(' ').slice(1).join(' '), nombre: cliente.nombre, direccion: null },
    lineas: c.pendientes.map((l, i) => ({ item: i + 1, descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precioUnitario, total: l.total })),
    gravada: soles(gravada), igv: soles(totalFinal - gravada), descuento: soles(descCent), descuentoMotivo: d?.motivo ?? null, total: soles(totalFinal), letras: letras(soles(totalFinal)),
    pagos: [
      ...(cent(c.adelanto) > 0 ? [{ metodo: 'Adelanto', monto: c.adelanto, referencia: `Adelanto ${c.reserva!.codigo}` }] : []),
      ...registrados.map((p) => ({ metodo: metodo(p.metodoPagoId)!.descripcion, monto: soles(p.monto), referencia: p.referencia ?? null })),
    ],
    estadoSunat: tipo === 'INTERNO' ? 'NO_APLICA' : 'PENDIENTE', reserva: c.reserva?.codigo ?? null, cajero: usuarioActual().nombre,
  };
  db.comprobantes.unshift(comp);
  for (const p of registrados) movimientoCaja('VENTA', p.metodoPagoId, soles(p.monto), `${numero} · Hab. ${grupo.map((g) => g.numero).join(', ')}`, c.reserva?.codigo ?? null);
  // Lo cobrado queda en cada estadía: turnos y cargos de este comprobante
  for (const [i, g] of grupo.entries()) {
    const e = g.estancia!;
    const turnosPagados = c.pendientes.filter((l) => l.tipo === 'HOSPEDAJE' && l.estanciaId === String(e.id)).reduce((acc, l) => acc + l.cantidad, 0);
    const cargos = c.pendientes.filter((l) => l.cargoId && l.estanciaId === String(e.id)).map((l) => Number(l.cargoId));
    if (e.pagos.length === 0 && !cerrar) marcar('checkin');
    e.pagos.push({ id: comp.id, numero, total: i === 0 ? soles(totalFinal) : '0.00', turnos: turnosPagados, cargos });
  }
  if (cerrar) cerrarGrupo(grupo, `Check-out ${numero}`);
  return { cerrada: cerrar, comprobanteId: comp.id, comprobante: numero, total: soles(totalFinal), descuento: soles(descCent), vuelto: soles(total - saldo) };
}

// ── Vistas de tablero y plano ──────────────────────────────────

function tablero() {
  const estados = R<Array<{ codigo: Estado; descripcion: string; color_hex: string }>>('/hospedaje/estados');
  const activos = db.habs.filter((h) => h.activo);
  const resumen: Partial<Record<Estado, number>> = {};
  for (const h of activos) resumen[h.estado] = (resumen[h.estado] ?? 0) + 1;
  return {
    generadoEn: new Date().toISOString(),
    resumen,
    pisos: [...db.pisos].sort((a, b) => a.numero - b.numero).map((p) => ({
      id: p.id, numero: p.numero, nombre: p.nombre,
      habitaciones: activos.filter((h) => h.pisoId === p.id).sort((a, b) => a.numero.localeCompare(b.numero)).map((h) => {
        const e = estados.find((x) => x.codigo === h.estado)!;
        const t = tipoDe(h);
        return {
          id: h.id, numero: h.numero, tipo: t.nombre, tipoId: t.id, capacidad: t.adultos, estado: h.estado, estadoDescripcion: e.descripcion, color: e.color_hex,
          siguientes: h.estancia ? [] : TRANSICIONES[h.estado].filter((x) => x !== 'OCUPADA'),
          estadoDesde: h.estadoDesde,
          limpieza: h.estado === 'LIMPIEZA' ? (() => {
            const minutos = Math.max(0, Math.floor((Date.now() - Date.parse(h.estadoDesde)) / 60_000));
            return { minutos, demorada: minutos > db.operacion.minutosLimpieza, esperados: db.operacion.minutosLimpieza };
          })() : null,
          estancia: h.estancia ? { id: h.estancia.id, huesped: h.estancia.huespedes[0]?.nombre ?? null, checkin: h.estancia.checkin, salidaPrevista: h.estancia.salidaPrevista, alerta: alerta(h.estancia.salidaPrevista) } : null,
        };
      }),
    })),
  };
}

function plano(): PisoPlano[] {
  return [...db.pisos].sort((a, b) => a.numero - b.numero).map((p) => ({
    ...p,
    habitaciones: db.habs.filter((h) => h.activo && h.pisoId === p.id).sort((a, b) => a.numero.localeCompare(b.numero)).map((h) => ({
      id: h.id, numero: h.numero, descripcion: h.descripcion, estado: h.estado, tipo: tipoDe(h), amenidades: h.amenidades,
      x: h.x, y: h.y, ancho: h.ancho, alto: h.alto, ubicada: true,
      estancia: h.estancia ? { huesped: h.estancia.huespedes[0]?.nombre ?? null, salidaPrevista: h.estancia.salidaPrevista, alerta: alerta(h.estancia.salidaPrevista) } : null,
    })),
  }));
}

function disponibilidad(q: URLSearchParams): Disponibilidad {
  const turno = turnos().find((t) => t.id === Number(q.get('turnoId')));
  if (!turno) return error(400, 'Turno no válido');
  const r = rango(q.get('llegada')!, Number(q.get('cantidad')), turno.duracion_horas, q.get('hora') ?? undefined);
  return {
    ...r,
    habitaciones: db.habs.filter((h) => h.activo).sort((a, b) => a.numero.localeCompare(b.numero)).map((h) => {
      const res = db.reservas.find((x) => abiertas(x) && x.habitaciones.some((y) => y.id === h.id) && cruza(x, r));
      const ocupada = !!h.estancia && !res && cruza({ entrada: h.estancia.checkin, salida: h.estancia.salidaPrevista }, r);
      return {
        id: h.id, numero: h.numero, tipo: tipoDe(h), libre: !res && !ocupada,
        motivo: res ? `Reservada (${res.codigo} · ${res.cliente.nombre})` : ocupada ? 'Ocupada en esas fechas' : null,
        aviso: h.estado === 'MANTENIMIENTO' ? 'En mantenimiento ahora' : h.estado === 'LIMPIEZA' ? 'En limpieza ahora: márcala lista antes del check-in' : null,
      };
    }),
  };
}

// ── Reservas ────────────────────────────────────────────────────

function crearReserva(b: Record<string, unknown>): Reserva {
  const cliente = db.clientes.find((c) => c.id === b.clienteId);
  const canal = canales().find((c) => c.id === b.canalId);
  const turno = turnos().find((t) => t.id === b.turnoId);
  if (!cliente || !canal || !turno) return error(400, 'Datos de la reserva incompletos');
  const pedidas = (b.habitaciones as Array<{ habitacionId: number; adultos: number; ninos: number }>) ?? [{ habitacionId: b.habitacionId as number, adultos: Number(b.adultos ?? 1), ninos: Number(b.ninos ?? 0) }];
  const cantidad = Number(b.cantidad);
  const r = rango(String(b.llegada), cantidad, turno.duracion_horas, b.hora as string | undefined);
  if (Date.parse(r.salida) <= Date.now()) return error(400, 'Las fechas de la reserva ya pasaron');
  const lineas = pedidas.map((p) => {
    const h = db.habs.find((x) => x.id === p.habitacionId) ?? error(400, 'La habitación no existe');
    const t = tipoDe(h);
    if (p.adultos > t.adultos) return error(400, `Habitación ${h.numero}: admite como máximo ${t.adultos} adultos`);
    if (db.reservas.some((x) => abiertas(x) && x.habitaciones.some((y) => y.id === h.id) && cruza(x, r))) return error(409, `La habitación ${h.numero} ya está reservada en ese rango de fechas`);
    const pr = precio(t.id, canal.id, turno.id) ?? error(404, 'No hay una tarifa vigente para esa combinación y fecha');
    return { h, t, p, pr };
  });
  const total = lineas.reduce((s, l) => s + cent(l.pr) * cantidad, 0);
  const adelanto = cent(Number(b.adelanto ?? 0));
  if (adelanto > total) return error(400, 'El adelanto no puede superar el total');
  if (adelanto > 0 && !b.metodoPagoId) return error(400, 'Indica cómo pagó el adelanto');
  if (adelanto > 0 && !db.caja) return error(409, 'La caja está cerrada. Ábrela en «Caja» para registrar el adelanto.', 'CAJA_CERRADA');
  const estado = b.confirmar || adelanto > 0 ? 'CONFIRMADA' : 'PENDIENTE';
  const nueva: Reserva = {
    id: id(), codigo: `R-${String(db.reservas.length + 1).padStart(6, '0')}`, estado, ...r,
    adultos: pedidas.reduce((s, p) => s + p.adultos, 0), ninos: pedidas.reduce((s, p) => s + (p.ninos ?? 0), 0),
    total: soles(total), comision: { porcentaje: canal.comisionPorcentaje, monto: soles(Math.round((total * Number(canal.comisionPorcentaje)) / 100)) },
    adelanto: soles(adelanto), saldo: soles(total - adelanto), observaciones: (b.observaciones as string) || null, codigoExterno: (b.codigoExterno as string) || null,
    motivoCancelacion: null, canceladaPor: null, canceladaEn: null, creada: new Date().toISOString(), canal: { id: canal.id, nombre: canal.nombre, esOta: canal.esOta }, cliente,
    habitaciones: lineas.map((l) => ({ id: l.h.id, numero: l.h.numero, tipo: l.t.nombre, turno: turno.nombre, horasTurno: turno.duracion_horas, cantidad, precio: l.pr })),
  };
  db.reservas.push(nueva);
  if (adelanto > 0) movimientoCaja('ADELANTO_RESERVA', Number(b.metodoPagoId), soles(adelanto), `Adelanto ${nueva.codigo} · ${cliente.nombre}`, nueva.codigo);
  for (const l of lineas) if (fechaDe(r.entrada) === hoyLima() && l.h.estado === 'DESOCUPADA') cambiarEstado(l.h, estado === 'CONFIRMADA' ? 'CONFIRMADA' : 'RESERVADA', `Reserva ${nueva.codigo}`);
  marcar('reserva');
  return nueva;
}

function accionReserva(r: Reserva, accion: string, b: Record<string, unknown>): Reserva {
  const abierta = r.estado === 'PENDIENTE' || r.estado === 'CONFIRMADA';
  const habs = r.habitaciones.map((x) => db.habs.find((h) => h.id === x.id)!);
  const hoy = hoyLima();
  if (accion === 'confirmar') {
    if (r.estado !== 'PENDIENTE') return error(400, 'Solo se confirma una reserva pendiente');
    r.estado = 'CONFIRMADA';
    for (const h of habs) if (h.estado === 'RESERVADA') cambiarEstado(h, 'CONFIRMADA', `Reserva ${r.codigo} confirmada`);
  } else if (accion === 'cancelar' || accion === 'no-show') {
    if (!abierta) return error(400, 'La reserva ya no está abierta');
    if (accion === 'no-show' && hoy < fechaDe(r.entrada)) return error(400, 'Solo se marca «no se presentó» desde el día de llegada');
    if (!String(b.motivo ?? '').trim()) return error(400, 'Indica el motivo');
    r.estado = accion === 'cancelar' ? 'CANCELADA' : 'NO_SHOW';
    Object.assign(r, { motivoCancelacion: String(b.motivo), canceladaPor: db.usuario, canceladaEn: new Date().toISOString() });
    for (const h of habs) if (h.estado === 'RESERVADA' || h.estado === 'CONFIRMADA') cambiarEstado(h, 'DESOCUPADA', `Reserva ${r.codigo} ${accion === 'cancelar' ? 'cancelada' : 'no se presentó'}`);
    if (accion === 'no-show') marcar('reserva');
  } else if (accion === 'checkin') {
    if (!abierta) return error(400, 'No se puede hacer check-in de esta reserva');
    if (hoy < fechaDe(r.entrada)) return error(400, `El check-in de esta reserva es desde el ${fechaDe(r.entrada)}`);
    for (const h of habs) if (!TRANSICIONES[h.estado].includes('OCUPADA')) return error(409, `La habitación ${h.numero} no está lista (está ${h.estado.toLowerCase()}). Márcala como lista en el tablero.`);
    const datos = (b.huespedes as Array<{ habitacionId: number; acompanantes?: number[] }>) ?? [];
    const canal = canales().find((c) => c.id === r.canal.id);
    for (const [i, h] of habs.entries()) {
      const rh = r.habitaciones[i];
      const acomp = datos.find((d) => d.habitacionId === h.id)?.acompanantes ?? [];
      // Con la operación configurada el tiempo corre desde que llegan
      const salidaPrev = db.operacion.configurada ? salidaSegunOperacion(new Date(), rh.horasTurno, rh.cantidad).toISOString() : r.salida;
      h.estancia = {
        id: id(), reservaId: r.id, checkin: new Date().toISOString(), salidaPrevista: salidaPrev, turno: rh.turno, horasTurno: rh.horasTurno, cantidad: rh.cantidad, precio: rh.precio,
        canal: r.canal.nombre, comision: canal?.comisionPorcentaje ?? '0.00', procedencia: (b.procedencia as string) || null,
        destino: (b.destino as string) || null, motivoViaje: (b.motivoViaje as string) || null, cargos: [], pagos: [],
        huespedes: [{ id: r.cliente.id, titular: true, nombre: r.cliente.nombre, documento: r.cliente.documento }, ...acomp.map((cid) => {
          const c = db.clientes.find((x) => x.id === cid)!;
          return { id: c.id, titular: false, nombre: c.nombre, documento: c.documento };
        })],
      };
      cambiarEstado(h, 'OCUPADA', `Check-in ${r.codigo}`);
    }
    r.estado = 'EN_CURSO';
    if (!db.operacion.cobroAlIngreso) marcar('checkin');
  }
  return r;
}

const SOLO_SISTEMA = 'En la demostración web esta acción no se guarda. Pruébala en el sistema instalado.';

/** Atiende una petición como lo haría la API. */
export async function responder<T>(rutaCompleta: string, init: RequestInit): Promise<T> {
  await new Promise((r) => setTimeout(r, 120)); // que se note como una petición
  const metodoHttp = (init.method ?? 'GET').toUpperCase();
  const [ruta, qs] = rutaCompleta.split('?');
  const q = new URLSearchParams(qs ?? '');
  const b = (init.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;
  const m = (patron: RegExp) => patron.exec(ruta);
  const salida = (v: unknown) => {
    guardar();
    return v as T;
  };

  // Sesión
  if (ruta === '/auth/login' && metodoHttp === 'POST') {
    if (!['admin', 'recepcion1'].includes(String(b.username)) || b.password !== CLAVE_DEMO) return error(401, 'Usuario o contraseña incorrectos. En la demo: admin o recepcion1 · Hotel2026!');
    db.usuario = String(b.username);
    return salida(usuarioActual());
  }
  if (ruta === '/auth/logout') {
    db.usuario = null;
    return salida(undefined);
  }
  if (ruta === '/auth/refresh') return db.usuario ? salida({}) : error(401, 'Sin sesión', 'SIN_SESION');
  if (!db.usuario) return error(401, 'Sin sesión', 'SIN_SESION');
  if (ruta === '/auth/me') return salida(usuarioActual());

  if (metodoHttp === 'GET') {
    if (ruta === '/hospedaje/tablero') return salida(tablero());
    if (ruta === '/hospedaje/operacion') return salida(db.operacion);
    if (ruta === '/hospedaje/plano') return salida(plano());
    if (ruta === '/hospedaje/amenidades') return salida(db.amenidades.map((a) => ({ ...a, habitaciones: db.habs.filter((h) => h.activo && h.amenidades.includes(a.codigo)).length })));
    if (ruta === '/reservas') {
      const desde = q.get('desde')!;
      const hasta = sumarDias(q.get('hasta')!, 1);
      return salida(db.reservas.filter((r) => r.estado !== 'CANCELADA' && fechaDe(r.entrada) < hasta && fechaDe(r.salida) >= desde));
    }
    if (ruta === '/reservas/disponibilidad') return salida(disponibilidad(q));
    if (ruta === '/clientes') {
      const t = (q.get('q') ?? '').toLowerCase();
      return salida(t.length < 2 ? [] : db.clientes.filter((c) => `${c.nombre} ${c.documento}`.toLowerCase().includes(t)).slice(0, 8));
    }
    if (ruta === '/facturacion/series/para-emitir') {
      const serie = { BOLETA: 'B001', FACTURA: 'F001', INTERNO: 'I001' }[q.get('tipo') as 'BOLETA'] ?? 'B001';
      return salida({ id: 0, serie, siguiente: `${serie}-${String((db.correlativos[serie] ?? 0) + 1).padStart(8, '0')}` });
    }
    if (ruta === '/clientes/cartera') {
      const t = (q.get('q') ?? '').toLowerCase();
      return salida(db.clientes.filter((c) => !t || `${c.nombre} ${c.documento}`.toLowerCase().includes(t)).slice(0, 50).map((c) => ({ ...c, email: null, activo: true })));
    }
    const ficha = m(/^\/clientes\/(\d+)$/);
    if (ficha) {
      const c = db.clientes.find((x) => x.id === Number(ficha[1])) ?? error(404, 'El cliente no existe');
      const [abrev, numero] = c.documento.split(' ');
      const tipos = R<Array<{ id: number; abreviatura: string }>>('/clientes/tipos-documento');
      const empresa = abrev === 'RUC' && numero.startsWith('20');
      const [nombres, ...resto] = c.nombre.split(' ');
      return salida({
        ...c, tipoDocumentoId: tipos.find((t) => t.abreviatura === abrev)?.id ?? 1, numeroDocumento: numero, paisNombre: c.pais,
        nombres: empresa ? null : nombres, apellidos: empresa ? null : resto.join(' ') || '-', razonSocial: empresa ? c.nombre : null,
        direccion: null, fechaNacimiento: null, sexo: null, email: null, observaciones: null, activo: true,
      });
    }
    if (ruta === '/libro-huespedes') {
      return salida(db.habs.filter((h) => h.estancia).flatMap((h) => h.estancia!.huespedes.map((x) => ({
        estanciaId: h.estancia!.id, entrada: h.estancia!.checkin, salida: null, habitacion: h.numero, huesped: x.nombre, documento: x.documento,
        nacionalidad: 'Perú', fechaNacimiento: null, sexo: null, procedencia: h.estancia!.procedencia, destino: h.estancia!.destino ?? null,
        motivoViaje: h.estancia!.motivoViaje ?? null, titular: x.titular,
      }))));
    }
    if (ruta === '/hospedaje/tarifas/vigente') {
      const p = precio(Number(q.get('tipoId')), Number(q.get('canalId')), Number(q.get('turnoId')));
      return p ? salida({ precio: p, moneda: 'PEN', simbolo: 'S/' }) : error(404, 'No hay una tarifa vigente para esa combinación y fecha');
    }
    if (ruta === '/hospedaje/config/tipos-habitacion') return salida(R<Array<{ id: number }>>(ruta).map((t) => ({ ...t, habitaciones: db.habs.filter((h) => h.activo && h.tipoId === t.id).length })));
    if (ruta === '/hospedaje/config/pisos') return salida(db.pisos.map((p) => ({ id: p.id, numero: p.numero, nombre: p.nombre, activo: true, habitaciones: db.habs.filter((h) => h.activo && h.pisoId === p.id).length })));
    if (ruta === '/hospedaje/config/habitaciones') {
      return salida(db.habs.map((h) => ({ id: h.id, numero: h.numero, descripcion: h.descripcion, activo: h.activo, estado: h.estado, piso: { id: h.pisoId, nombre: pisoDe(h.pisoId).nombre, numero: pisoDe(h.pisoId).numero }, tipo: { id: h.tipoId, nombre: tipoDe(h).nombre } })));
    }
    const hist = m(/^\/hospedaje\/habitaciones\/(\d+)\/historial$/);
    if (hist) return salida(db.habs.find((h) => h.id === Number(hist[1]))?.historial ?? []);
    if (ruta === '/hospedaje/tarifas/historial') return salida([]);
    if (ruta === '/caja') return salida({ cajas: [{ id: 1, nombre: 'Recepción 1' }], sesion: sesionCaja(), ultimoCierre: db.ultimoCierre });
    const porHab = m(/^\/estancias\/habitacion\/(\d+)$/);
    if (porHab) return salida(vistaEstancia(db.habs.find((h) => h.id === Number(porHab[1])) ?? error(404, 'La habitación no existe')));
    const est = m(/^\/estancias\/(\d+)$/);
    if (est) return salida(vistaEstancia(habDeEstancia(Number(est[1]))));
    if (ruta === '/comprobantes') {
      return salida(db.comprobantes.filter((c) => c.fecha === hoyLima()).map((c) => ({ id: c.id, tipo: c.tipo, numero: c.numero, cliente: c.cliente.nombre, total: c.total, estadoSunat: c.estadoSunat, hora: c.hora.slice(0, 5) })));
    }
    const comp = m(/^\/comprobantes\/(\d+)$/);
    if (comp) return salida(db.comprobantes.find((c) => c.id === Number(comp[1])) ?? error(404, 'El comprobante no existe'));
    if (ruta in F.rutas) return salida(F.rutas[ruta]);
    return error(404, 'No disponible en la demostración');
  }

  // Escrituras
  const estado = m(/^\/hospedaje\/habitaciones\/(\d+)\/estado$/);
  if (estado) {
    const h = db.habs.find((x) => x.id === Number(estado[1]))!;
    const hacia = b.estado as Estado;
    if (!TRANSICIONES[h.estado].includes(hacia)) return error(409, `No se puede pasar de ${h.estado} a ${hacia}`);
    if (h.estado === 'OCUPADA' && h.estancia) return error(409, 'La habitación tiene una estadía en curso: haz el check-out para cobrar.');
    cambiarEstado(h, hacia, (b.motivo as string) ?? null);
    return salida({ ok: true });
  }

  if (ruta === '/caja/abrir') {
    if (db.caja) return error(409, 'Ya hay una caja abierta en la sucursal');
    db.caja = { id: id(), apertura: new Date().toISOString(), montoApertura: Number(b.monto).toFixed(2), usuario: usuarioActual().nombre, movimientos: [] };
    marcar('caja');
    return salida(sesionCaja());
  }
  if (ruta === '/caja/movimientos') {
    movimientoCaja(String(b.concepto), metodos().find((x) => x.es_efectivo)!.id, Number(b.monto).toFixed(2), String(b.descripcion));
    return salida(sesionCaja());
  }
  if (ruta === '/caja/cerrar') {
    const s = sesionCaja() ?? error(409, 'La caja está cerrada.');
    const declarado = cent(Number(b.montoDeclarado));
    const res = { ...s, estado: 'CERRADA' as const, cierre: new Date().toISOString(), esperado: s.efectivoEsperado, declarado: soles(declarado), diferencia: soles(declarado - cent(s.efectivoEsperado)) };
    db.ultimoCierre = { id: s.id, cierre: res.cierre, esperado: res.esperado, declarado: res.declarado, diferencia: res.diferencia, usuario: s.usuario };
    db.caja = null;
    marcar('cierre');
    return salida(res);
  }

  if (ruta === '/estancias' && metodoHttp === 'POST') {
    const h = db.habs.find((x) => x.id === b.habitacionId) ?? error(400, 'La habitación no existe');
    if (!TRANSICIONES[h.estado].includes('OCUPADA')) return error(409, `La habitación no está lista (está ${h.estado.toLowerCase()})`);
    const turno = turnos().find((t) => t.id === b.turnoId)!;
    const canal = canales().find((c) => c.id === b.canalId)!;
    const p = precio(h.tipoId, canal.id, turno.id) ?? error(404, 'No hay tarifa para este turno');
    const cantidad = Number(b.cantidad);
    const ahora = Date.now();
    const salidaPrev = db.operacion.configurada
      ? salidaSegunOperacion(new Date(ahora), turno.duracion_horas, cantidad).toISOString()
      : turno.duracion_horas === 24 ? rango(hoyLima(), cantidad, 24).salida : new Date(ahora + turno.duracion_horas * cantidad * 3_600_000).toISOString();
    const ids = [Number(b.clienteId), ...((b.acompanantes as number[]) ?? [])];
    // Un huésped no se aloja en dos habitaciones a la vez (como la API)
    const alojado = db.habs.find((x) => x.estancia?.huespedes.some((g) => ids.includes(g.id)));
    if (alojado) return error(409, `${alojado.estancia!.huespedes.find((g) => ids.includes(g.id))!.nombre} ya está alojado en la habitación ${alojado.numero}`);
    h.estancia = {
      id: id(), reservaId: null, checkin: new Date(ahora).toISOString(), salidaPrevista: salidaPrev, turno: turno.nombre, horasTurno: turno.duracion_horas, cantidad, precio: p,
      canal: canal.nombre, comision: canal.comisionPorcentaje, procedencia: (b.procedencia as string) || null,
      destino: (b.destino as string) || null, motivoViaje: (b.motivoViaje as string) || null, cargos: [], pagos: [],
      huespedes: ids.map((cid, i) => {
        const c = db.clientes.find((x) => x.id === cid)!;
        return { id: c.id, titular: i === 0, nombre: c.nombre, documento: c.documento };
      }),
    };
    cambiarEstado(h, 'OCUPADA', 'Check-in directo (sin reserva)');
    // Con pago adelantado el paso se completa al cobrar
    if (!db.operacion.cobroAlIngreso) marcar('checkin');
    return salida(vistaEstancia(h));
  }
  const huesped = m(/^\/estancias\/(\d+)\/huespedes$/);
  if (huesped) {
    const h = habDeEstancia(Number(huesped[1]));
    const c = db.clientes.find((x) => x.id === b.clienteId) ?? error(400, 'El huésped no existe');
    if (h.estancia!.huespedes.some((x) => x.id === c.id)) return error(409, 'Ese huésped ya está registrado en la habitación');
    h.estancia!.huespedes.push({ id: c.id, titular: false, nombre: c.nombre, documento: c.documento });
    return salida(vistaEstancia(h));
  }
  const cargo = m(/^\/estancias\/(\d+)\/cargos$/);
  if (cargo) {
    const h = habDeEstancia(Number(cargo[1]));
    const prod = R<Producto[]>('/productos').find((p) => p.id === b.productoId);
    const precioU = prod ? Number(b.precio ?? prod.precio) : Number(b.precio);
    const cantidad = Number(b.cantidad);
    h.estancia!.cargos.push({ id: id(), descripcion: prod?.nombre ?? String(b.descripcion), cantidad, precio: precioU.toFixed(2), total: soles(Math.round(cantidad * precioU * 100)), fecha: new Date().toISOString() });
    return salida(vistaEstancia(h));
  }
  const anular = m(/^\/estancias\/(\d+)\/cargos\/(\d+)$/);
  if (anular && metodoHttp === 'DELETE') {
    const h = habDeEstancia(Number(anular[1]));
    h.estancia!.cargos = h.estancia!.cargos.filter((c) => c.id !== Number(anular[2]));
    return salida(vistaEstancia(h));
  }
  const ext = m(/^\/estancias\/(\d+)\/extension$/);
  if (ext) {
    const h = habDeEstancia(Number(ext[1]));
    const turnos = Number(b.turnos);
    if (!Number.isInteger(turnos) || turnos < 1 || turnos > 30) return error(400, 'La extensión debe ser de 1 a 30 turnos');
    const e = h.estancia!;
    const nueva = new Date(Date.parse(e.salidaPrevista) + e.horasTurno * turnos * 3_600_000).toISOString();
    if (e.horasTurno !== 24) {
      // Tampoco pasa la hora máxima de la franja en que entró (operación real)
      const p = salidaPrevista(new Date(e.checkin), e.horasTurno, 1, db.operacion);
      if (p.maxima && Date.parse(nueva) > p.maxima.getTime() + MARGEN_MINUTO_MS) {
        const caben = Math.floor((p.maxima.getTime() + MARGEN_MINUTO_MS - Date.parse(e.salidaPrevista)) / (e.horasTurno * 3_600_000));
        return error(400, `Entró en la franja «${p.franja}»: la salida máxima es a las ${horaConDia(p.maxima).replace(' de mañana', '')}. ${caben > 0 ? `Se puede extender hasta ${caben} ${caben === 1 ? 'turno' : 'turnos'}.` : 'Ya no se puede extender por horas.'}`);
      }
    }
    if (db.reservas.some((x) => x.id !== e.reservaId && abiertas(x) && x.habitaciones.some((y) => y.id === h.id) && cruza(x, { entrada: e.salidaPrevista, salida: nueva }))) {
      return error(409, `La habitación ${h.numero} ya está reservada en ese horario`);
    }
    Object.assign(e, { cantidad: e.cantidad + turnos, salidaPrevista: nueva });
    marcar('extension');
    return salida(vistaEstancia(h));
  }
  const tras = m(/^\/estancias\/(\d+)\/traslado$/);
  if (tras) {
    const origen = habDeEstancia(Number(tras[1]));
    const destino = db.habs.find((x) => x.id === b.habitacionId) ?? error(400, 'La habitación de destino no existe');
    if (String(b.motivo ?? '').trim().length < 5) return error(400, 'El motivo del traslado debe tener entre 5 y 200 caracteres');
    if (destino.id === origen.id) return error(400, 'Elige una habitación distinta');
    if (destino.estancia || !TRANSICIONES[destino.estado].includes('OCUPADA')) return error(409, `La habitación ${destino.numero} no está lista (está ${destino.estado.toLowerCase()})`);
    destino.estancia = origen.estancia;
    origen.estancia = null;
    cambiarEstado(origen, 'LIMPIEZA', `Traslado a la ${destino.numero}: ${b.motivo}`);
    cambiarEstado(destino, 'OCUPADA', `Traslado desde la ${origen.numero}: ${b.motivo}`);
    return salida(vistaEstancia(destino));
  }
  const edCliente = m(/^\/clientes\/(\d+)$/);
  if (edCliente && metodoHttp === 'PATCH') {
    const c = db.clientes.find((x) => x.id === Number(edCliente[1])) ?? error(404, 'El cliente no existe');
    const nombre = (b.razonSocial as string) || [b.nombres, b.apellidos].filter(Boolean).join(' ');
    if (nombre) c.nombre = nombre;
    if (b.telefono !== undefined) c.telefono = (b.telefono as string) || null;
    if (typeof b.pais === 'string') c.pais = b.pais;
    return salida(c);
  }
  const co = m(/^\/estancias\/(\d+)\/(checkout|cobro)$/);
  if (co) return salida(cobrar(habDeEstancia(Number(co[1])), b, co[2] === 'checkout'));

  if (ruta === '/hospedaje/operacion' && metodoHttp === 'PUT') {
    const o = b as unknown as Operacion;
    if (!Number.isInteger(o.minutosLimpieza) || o.minutosLimpieza < 5 || o.minutosLimpieza > 240) return error(400, 'El tiempo de limpieza debe ser de 5 a 240 minutos');
    db.operacion = { ...o, configurada: true, franjas: [...o.franjas].sort((x, y) => x.desde.localeCompare(y.desde)) };
    return salida(db.operacion);
  }

  const pisoPlano = m(/^\/hospedaje\/plano\/pisos\/(\d+)$/);
  if (pisoPlano && metodoHttp === 'PUT') {
    const p = pisoDe(Number(pisoPlano[1]));
    const habs = b.habitaciones as Array<{ id: number; x: number; y: number; ancho: number; alto: number }>;
    const elems = b.elementos as ElementoPlano[];
    const piezas = [...habs, ...elems];
    for (const [i, r] of piezas.entries()) {
      if (!cabe(r, Number(b.columnas), Number(b.filas), piezas.filter((_, j) => j !== i))) return error(400, 'Hay piezas que se superponen o quedan fuera del plano');
    }
    Object.assign(p, { columnas: b.columnas, filas: b.filas, elementos: elems.map((e) => ({ ...e, id: id() })) });
    for (const r of habs) Object.assign(db.habs.find((h) => h.id === r.id)!, { x: r.x, y: r.y, ancho: r.ancho, alto: r.alto });
    return salida({ pisoId: p.id });
  }
  if (ruta === '/hospedaje/plano/pisos' && metodoHttp === 'POST') {
    const numero = Number(b.numero);
    if (db.pisos.some((p) => p.numero === numero)) return error(409, `Ya existe el piso ${numero} en esta sucursal`);
    const d = distribucionInicial(Number(b.habitaciones ?? 0));
    const piso: Piso = {
      id: id(), numero, nombre: String(b.nombre), columnas: d.columnas, filas: d.filas,
      elementos: [{ id: id(), tipo: 'PASILLO', etiqueta: null, ...d.pasillo }, { id: id(), tipo: 'ESCALERA', etiqueta: null, ...d.escalera }],
    };
    db.pisos.push(piso);
    const conteo = new Map<string, number>();
    for (const h of db.habs.filter((x) => x.activo && x.tipoId === b.tipoHabitacionId && x.amenidades.length)) {
      const k = [...h.amenidades].sort().join(',');
      conteo.set(k, (conteo.get(k) ?? 0) + 1);
    }
    const masComun = [...conteo.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
    const numeros = d.habitaciones.map((r, i) => {
      const n = `${numero}${String(i + 1).padStart(2, '0')}`;
      db.habs.push({ id: id(), pisoId: piso.id, numero: n, descripcion: null, tipoId: Number(b.tipoHabitacionId), estado: 'DESOCUPADA', ...r, amenidades: masComun ? masComun.split(',') : [], activo: true, estancia: null, estadoDesde: new Date().toISOString(), historial: [] });
      return n;
    });
    return salida({ ...piso, habitaciones: numeros });
  }
  if (ruta === '/hospedaje/habitaciones' && metodoHttp === 'POST') {
    if (db.habs.some((h) => h.numero === b.numero)) return error(409, `Ya existe la habitación ${b.numero} en esta sucursal`);
    const r = (b.plano as { x: number; y: number; ancho: number; alto: number }) ?? { x: 0, y: 0, ancho: 3, alto: 2 };
    const h: Hab = { id: id(), pisoId: Number(b.pisoId), numero: String(b.numero), descripcion: null, tipoId: Number(b.tipoHabitacionId), estado: 'DESOCUPADA', ...r, amenidades: (b.amenidades as string[]) ?? [], activo: true, estancia: null, estadoDesde: new Date().toISOString(), historial: [] };
    db.habs.push(h);
    return salida(h);
  }
  const hab = m(/^\/hospedaje\/habitaciones\/(\d+)$/);
  if (hab && metodoHttp === 'PATCH') {
    const h = db.habs.find((x) => x.id === Number(hab[1]))!;
    if (b.activo === false && h.estado === 'OCUPADA') return error(409, 'La habitación está ocupada; haz el check-out antes de desactivarla');
    if (typeof b.numero === 'string') h.numero = b.numero;
    if (typeof b.tipoHabitacionId === 'number') h.tipoId = b.tipoHabitacionId;
    if (typeof b.activo === 'boolean') h.activo = b.activo;
    return salida({ id: h.id });
  }
  const amen = m(/^\/hospedaje\/habitaciones\/(\d+)\/amenidades$/);
  if (amen) {
    const h = db.habs.find((x) => x.id === Number(amen[1]))!;
    const destino = b.aplicarATipo ? db.habs.filter((x) => x.activo && x.tipoId === h.tipoId) : [h];
    for (const x of destino) x.amenidades = [...(b.amenidades as string[])];
    return salida({ habitaciones: destino.length, amenidades: b.amenidades });
  }
  if (ruta === '/hospedaje/amenidades' && metodoHttp === 'POST') {
    const nombre = String(b.nombre).trim();
    const codigo = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (db.amenidades.some((a) => a.codigo === codigo)) return error(409, `Ya existe la comodidad «${nombre}»`);
    const a: Amenidad = { id: id(), codigo, nombre, icono: String(b.icono), activo: true, habitaciones: 0 };
    db.amenidades.push(a);
    return salida(a);
  }
  if (ruta === '/clientes' && metodoHttp === 'POST') {
    const tipos = R<Array<{ id: number; abreviatura: string }>>('/clientes/tipos-documento');
    const t = tipos.find((x) => x.id === b.tipoDocumentoId);
    const numero = String(b.numeroDocumento ?? '').toUpperCase();
    if (t?.abreviatura === 'DNI' && !/^\d{8}$/.test(numero)) return error(400, 'El DNI tiene 8 dígitos');
    if (t?.abreviatura === 'RUC' && !/^(10|15|17|20)\d{9}$/.test(numero)) return error(400, 'RUC no válido');
    const nombre = (b.razonSocial as string) || `${b.nombres ?? ''} ${b.apellidos ?? ''}`.trim();
    if (!nombre) return error(400, 'Escribe nombres y apellidos');
    if (db.clientes.some((c) => c.documento === `${t?.abreviatura} ${numero}`)) return error(409, `Ya hay un cliente con ${t?.abreviatura} ${numero}`);
    const c: Cliente = { id: id(), documento: `${t?.abreviatura ?? 'DOC'} ${numero}`, nombre, telefono: (b.telefono as string) || null, pais: String(b.pais ?? 'PE') };
    db.clientes.push(c);
    return salida(c);
  }
  if (ruta === '/reservas' && metodoHttp === 'POST') return salida(crearReserva(b));
  const acc = m(/^\/reservas\/(\d+)\/(confirmar|cancelar|no-show|checkin)$/);
  if (acc) {
    const r = db.reservas.find((x) => x.id === Number(acc[1])) ?? error(404, 'La reserva no existe');
    return salida(accionReserva(r, acc[2], b));
  }

  return error(403, SOLO_SISTEMA);
}
