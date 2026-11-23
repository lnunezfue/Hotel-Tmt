/**
 * API SIMULADA para la demostración publicada en la web (build con VITE_DEMO=1). No forma parte del sistema:
 * responde en el navegador con una foto de la API real (datos.json, tomada del seed) y reproduce las reglas
 * principales para que se pueda recorrer el flujo: estados del tablero, plano, comodidades, reservas y check-in.
 * Los cambios se guardan solo en este navegador.
 */
import { ApiError } from '../lib/api/cliente';
import type { Amenidad, Cliente, Disponibilidad, ElementoPlano, Estado, PisoPlano, Reserva } from '../lib/api/tipos';
import { cabe, distribucionInicial } from '../features/hospedaje/plano';
import { diasEntre, fechaDe, hoyLima, sumarDias } from '../features/reservas/fechas';
import foto from './datos.json';

const CLAVE = 'hotel-demo-v1';
const CLAVE_DEMO = 'Hotel2026!';
const TRANSICIONES: Record<Estado, Estado[]> = {
  DESOCUPADA: ['RESERVADA', 'OCUPADA', 'MANTENIMIENTO', 'LIMPIEZA'],
  RESERVADA: ['CONFIRMADA', 'OCUPADA', 'DESOCUPADA'],
  CONFIRMADA: ['OCUPADA', 'DESOCUPADA'],
  OCUPADA: ['LIMPIEZA'],
  LIMPIEZA: ['DESOCUPADA', 'MANTENIMIENTO'],
  MANTENIMIENTO: ['DESOCUPADA'],
};

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
  estancia: null | { id: number; huesped: string | null; checkin: string; salidaPrevista: string };
  historial: Array<{ id: number; fecha: string; motivo: string | null; usuario: string | null; desde: Estado | null; hacia: Estado }>;
}
interface Piso { id: number; numero: number; nombre: string; columnas: number; filas: number; elementos: ElementoPlano[] }
interface Tipo { id: number; nombre: string; adultos: number; ninos: number }
interface Datos {
  version: number;
  usuario: string | null;
  pisos: Piso[];
  habs: Hab[];
  tipos: Tipo[];
  amenidades: Amenidad[];
  reservas: Reserva[];
  clientes: Cliente[];
  seq: number;
}

type Foto = typeof foto & { rutas: Record<string, unknown> };
const F = foto as unknown as Foto;
const R = <T,>(ruta: string) => F.rutas[ruta] as T;

const DIA_MS = 86_400_000;

/** Corre las fechas de la foto a hoy: estancias por el tiempo exacto, reservas por días enteros (mantienen 14:00 / 12:00). */
function inicial(): Datos {
  const msDesde = Date.now() - Date.parse(F.capturado);
  const diasDesde = diasEntre(F.hoy, hoyLima());
  const mover = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
  const plano = R<PisoPlano[]>('/hospedaje/plano');
  const tablero = R<{ pisos: Array<{ habitaciones: Array<{ id: number; estancia: Hab['estancia'] | null }> }> }>('/hospedaje/tablero');
  const estancias = new Map(tablero.pisos.flatMap((p) => p.habitaciones).map((h) => [h.id, h.estancia]));
  const tipos = R<Array<{ id: number; nombre: string; capacidadAdultos: number; capacidadNinos: number }>>('/hospedaje/config/tipos-habitacion');
  return {
    version: 1,
    usuario: null,
    pisos: plano.map((p) => ({ id: p.id, numero: p.numero, nombre: p.nombre, columnas: p.columnas, filas: p.filas, elementos: p.elementos })),
    habs: plano.flatMap((p) =>
      p.habitaciones.map((h) => {
        const e = estancias.get(h.id);
        return {
          id: h.id, pisoId: p.id, numero: h.numero, descripcion: h.descripcion, tipoId: h.tipo.id, estado: h.estado,
          x: h.x, y: h.y, ancho: h.ancho, alto: h.alto, amenidades: h.amenidades, activo: true,
          estancia: e ? { id: e.id, huesped: e.huesped, checkin: mover(e.checkin, msDesde), salidaPrevista: mover(e.salidaPrevista, msDesde) } : null,
          historial: [],
        };
      }),
    ),
    tipos: tipos.map((t) => ({ id: t.id, nombre: t.nombre, adultos: t.capacidadAdultos, ninos: t.capacidadNinos })),
    amenidades: R<Amenidad[]>('/hospedaje/amenidades'),
    reservas: R<Reserva[]>('/reservas').map((r) => ({ ...r, entrada: mover(r.entrada, diasDesde * DIA_MS), salida: mover(r.salida, diasDesde * DIA_MS) })),
    clientes: F.clientes as Cliente[],
    seq: 1000,
  };
}

let db: Datos = cargar();

function cargar(): Datos {
  try {
    const t = localStorage.getItem(CLAVE);
    if (t) {
      const d = JSON.parse(t) as Datos;
      if (d.version === 1) return d;
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
}

/** Vuelve a la foto original (botón «Reiniciar demo»). */
export function reiniciarDemo() {
  const usuario = db.usuario;
  db = { ...inicial(), usuario };
  guardar();
}

const error = (status: number, message: string, codigo?: string): never => {
  throw new ApiError(status, message, codigo);
};
const id = () => ++db.seq;
const tipoDe = (h: Hab) => db.tipos.find((t) => t.id === h.tipoId)!;
const pisoDe = (pisoId: number) => db.pisos.find((p) => p.id === pisoId)!;
const usuarioActual = () => (db.usuario === 'recepcion1' ? F.me.recepcion1 : F.me.admin);

function alerta(salida: string): 'VENCIDA' | 'POR_VENCER' | null {
  const min = (Date.parse(salida) - Date.now()) / 60000;
  return min < 0 ? 'VENCIDA' : min <= 30 ? 'POR_VENCER' : null;
}

function rango(llegada: string, cantidad: number, horas: number, hora?: string): { entrada: string; salida: string } {
  if (horas === 24) {
    const entrada = Date.parse(`${llegada}T19:00:00Z`);
    return { entrada: new Date(entrada).toISOString(), salida: new Date(Date.parse(`${sumarDias(llegada, cantidad)}T17:00:00Z`)).toISOString() };
  }
  const [hh, mm] = (hora ?? '14:00').split(':').map(Number);
  const entrada = Date.parse(`${llegada}T00:00:00Z`) + (hh + 5) * 3_600_000 + mm * 60_000;
  return { entrada: new Date(entrada).toISOString(), salida: new Date(entrada + horas * cantidad * 3_600_000).toISOString() };
}
const cruza = (a: { entrada: string; salida: string }, b: { entrada: string; salida: string }) => a.entrada < b.salida && b.entrada < a.salida;
const abiertas = (r: Reserva) => ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO'].includes(r.estado);

function cambiarEstado(h: Hab, hacia: Estado, motivo: string | null) {
  h.historial.unshift({ id: id(), fecha: new Date().toISOString(), motivo, usuario: usuarioActual().nombre, desde: h.estado, hacia });
  h.estado = hacia;
}

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
        return {
          id: h.id, numero: h.numero, tipo: tipoDe(h).nombre, capacidad: tipoDe(h).adultos, estado: h.estado, estadoDescripcion: e.descripcion, color: e.color_hex,
          siguientes: TRANSICIONES[h.estado],
          estancia: h.estancia ? { ...h.estancia, alerta: alerta(h.estancia.salidaPrevista) } : null,
        };
      }),
    })).filter((p) => p.habitaciones.length || true),
  };
}

function plano(): PisoPlano[] {
  return [...db.pisos].sort((a, b) => a.numero - b.numero).map((p) => ({
    ...p,
    habitaciones: db.habs.filter((h) => h.activo && h.pisoId === p.id).sort((a, b) => a.numero.localeCompare(b.numero)).map((h) => ({
      id: h.id, numero: h.numero, descripcion: h.descripcion, estado: h.estado, tipo: tipoDe(h), amenidades: h.amenidades,
      x: h.x, y: h.y, ancho: h.ancho, alto: h.alto, ubicada: true,
      estancia: h.estancia ? { huesped: h.estancia.huesped, salidaPrevista: h.estancia.salidaPrevista, alerta: alerta(h.estancia.salidaPrevista) } : null,
    })),
  }));
}

function precio(tipoId: number, canalId: number, turnoId: number): string | null {
  const t = R<{ celdas: Array<{ tipoId: number; canalId: number; turnoId: number; vigente: { precio: string } | null }> }>('/hospedaje/tarifas');
  return t.celdas.find((c) => c.tipoId === tipoId && c.canalId === canalId && c.turnoId === turnoId)?.vigente?.precio ?? null;
}

function disponibilidad(q: URLSearchParams): Disponibilidad {
  const turno = R<Array<{ id: number; duracion_horas: number }>>('/hospedaje/turnos').find((t) => t.id === Number(q.get('turnoId')));
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
        aviso: h.estado === 'MANTENIMIENTO' ? 'En mantenimiento ahora' : null,
      };
    }),
  };
}

function crearReserva(b: Record<string, unknown>): Reserva {
  const h = db.habs.find((x) => x.id === b.habitacionId);
  const cliente = db.clientes.find((c) => c.id === b.clienteId);
  const canal = R<Array<{ id: number; nombre: string; esOta: boolean }>>('/hospedaje/config/canales').find((c) => c.id === b.canalId);
  const turno = R<Array<{ id: number; nombre: string; duracion_horas: number }>>('/hospedaje/turnos').find((t) => t.id === b.turnoId);
  if (!h || !cliente || !canal || !turno) return error(400, 'Datos de la reserva incompletos');
  const cantidad = Number(b.cantidad);
  const r = rango(String(b.llegada), cantidad, turno.duracion_horas, b.hora as string | undefined);
  if (Date.parse(r.salida) <= Date.now()) return error(400, 'Las fechas de la reserva ya pasaron');
  const t = tipoDe(h);
  const adultos = Number(b.adultos);
  const ninos = Number(b.ninos ?? 0);
  if (adultos > t.adultos) return error(400, `La habitación admite como máximo ${t.adultos} adultos`);
  if (adultos + ninos > t.adultos + t.ninos) return error(400, `La habitación admite como máximo ${t.adultos + t.ninos} personas`);
  if (db.reservas.some((x) => abiertas(x) && x.habitaciones.some((y) => y.id === h.id) && cruza(x, r))) return error(409, 'La habitación ya está reservada en ese rango de fechas');
  const p = precio(t.id, canal.id, turno.id);
  if (!p) return error(404, 'No hay una tarifa vigente para esa combinación y fecha');
  const total = (Number(p) * cantidad).toFixed(2);
  const adelanto = Number(b.adelanto ?? 0).toFixed(2);
  const estado = b.confirmar || Number(adelanto) > 0 ? 'CONFIRMADA' : 'PENDIENTE';
  const nueva: Reserva = {
    id: id(), codigo: `R-${String(db.reservas.length + 1).padStart(6, '0')}`, estado, ...r, adultos, ninos, total, adelanto,
    saldo: (Number(total) - Number(adelanto)).toFixed(2), observaciones: (b.observaciones as string) || null, codigoExterno: (b.codigoExterno as string) || null,
    motivoCancelacion: null, creada: new Date().toISOString(), canal: { id: canal.id, nombre: canal.nombre, esOta: canal.esOta }, cliente,
    habitaciones: [{ id: h.id, numero: h.numero, tipo: t.nombre, turno: turno.nombre, horasTurno: turno.duracion_horas, cantidad, precio: p }],
  };
  db.reservas.push(nueva);
  if (fechaDe(r.entrada) === hoyLima() && h.estado === 'DESOCUPADA') cambiarEstado(h, estado === 'CONFIRMADA' ? 'CONFIRMADA' : 'RESERVADA', `Reserva ${nueva.codigo}`);
  return nueva;
}

function accionReserva(r: Reserva, accion: string, b: Record<string, unknown>): Reserva {
  const abierta = r.estado === 'PENDIENTE' || r.estado === 'CONFIRMADA';
  const h = db.habs.find((x) => x.id === r.habitaciones[0]?.id);
  const hoy = hoyLima();
  if (accion === 'confirmar') {
    if (r.estado !== 'PENDIENTE') return error(400, 'Solo se confirma una reserva pendiente');
    r.estado = 'CONFIRMADA';
    if (h?.estado === 'RESERVADA') cambiarEstado(h, 'CONFIRMADA', `Reserva ${r.codigo} confirmada`);
  } else if (accion === 'cancelar' || accion === 'no-show') {
    if (!abierta) return error(400, 'La reserva ya no está abierta');
    if (accion === 'no-show' && hoy < fechaDe(r.entrada)) return error(400, 'Solo se marca «no se presentó» desde el día de llegada');
    r.estado = accion === 'cancelar' ? 'CANCELADA' : 'NO_SHOW';
    if (accion === 'cancelar') r.motivoCancelacion = String(b.motivo ?? '');
    if (h && (h.estado === 'RESERVADA' || h.estado === 'CONFIRMADA')) cambiarEstado(h, 'DESOCUPADA', `Reserva ${r.codigo} ${accion === 'cancelar' ? 'cancelada' : 'no se presentó'}`);
  } else if (accion === 'checkin') {
    if (!abierta) return error(400, 'No se puede hacer check-in de esta reserva');
    if (hoy < fechaDe(r.entrada)) return error(400, `El check-in de esta reserva es desde el ${fechaDe(r.entrada)}`);
    if (!h || !TRANSICIONES[h.estado].includes('OCUPADA')) return error(409, `La habitación no está lista (está ${h?.estado.toLowerCase()})`);
    h.estancia = { id: id(), huesped: r.cliente.nombre, checkin: new Date().toISOString(), salidaPrevista: r.salida };
    cambiarEstado(h, 'OCUPADA', `Check-in ${r.codigo}`);
    r.estado = 'EN_CURSO';
  }
  return r;
}

const SOLO_SISTEMA = 'En la demostración web esta acción no se guarda. Pruébala en el sistema instalado.';

/** Atiende una petición como lo haría la API. */
export async function responder<T>(rutaCompleta: string, init: RequestInit): Promise<T> {
  await new Promise((r) => setTimeout(r, 120)); // que se note como una petición
  const metodo = (init.method ?? 'GET').toUpperCase();
  const [ruta, qs] = rutaCompleta.split('?');
  const q = new URLSearchParams(qs ?? '');
  const b = (init.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;
  const m = (patron: RegExp) => patron.exec(ruta);
  const salida = (v: unknown) => {
    guardar();
    return v as T;
  };

  // Sesión
  if (ruta === '/auth/login' && metodo === 'POST') {
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

  if (metodo === 'GET') {
    if (ruta === '/hospedaje/tablero') return salida(tablero());
    if (ruta === '/hospedaje/plano') return salida(plano());
    if (ruta === '/hospedaje/amenidades') {
      return salida(db.amenidades.map((a) => ({ ...a, habitaciones: db.habs.filter((h) => h.activo && h.amenidades.includes(a.codigo)).length })));
    }
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
    if (ruta === '/hospedaje/tarifas/vigente') {
      const p = precio(Number(q.get('tipoId')), Number(q.get('canalId')), Number(q.get('turnoId')));
      return p ? salida({ precio: p, moneda: 'PEN', simbolo: 'S/' }) : error(404, 'No hay una tarifa vigente para esa combinación y fecha');
    }
    if (ruta === '/hospedaje/config/tipos-habitacion') {
      return salida(R<Array<{ id: number }>>(ruta).map((t) => ({ ...t, habitaciones: db.habs.filter((h) => h.activo && h.tipoId === t.id).length })));
    }
    if (ruta === '/hospedaje/config/pisos') {
      return salida(db.pisos.map((p) => ({ id: p.id, numero: p.numero, nombre: p.nombre, activo: true, habitaciones: db.habs.filter((h) => h.activo && h.pisoId === p.id).length })));
    }
    if (ruta === '/hospedaje/config/habitaciones') {
      return salida(db.habs.map((h) => ({ id: h.id, numero: h.numero, descripcion: h.descripcion, activo: h.activo, estado: h.estado, piso: { id: h.pisoId, nombre: pisoDe(h.pisoId).nombre, numero: pisoDe(h.pisoId).numero }, tipo: { id: h.tipoId, nombre: tipoDe(h).nombre } })));
    }
    const hist = m(/^\/hospedaje\/habitaciones\/(\d+)\/historial$/);
    if (hist) return salida(db.habs.find((h) => h.id === Number(hist[1]))?.historial ?? []);
    if (ruta === '/hospedaje/tarifas/historial') return salida([]);
    if (ruta in F.rutas) return salida(F.rutas[ruta]);
    return error(404, 'No disponible en la demostración');
  }

  // Escrituras
  const estado = m(/^\/hospedaje\/habitaciones\/(\d+)\/estado$/);
  if (estado) {
    const h = db.habs.find((x) => x.id === Number(estado[1]))!;
    const hacia = b.estado as Estado;
    if (!TRANSICIONES[h.estado].includes(hacia)) return error(409, `No se puede pasar de ${h.estado} a ${hacia}`);
    if (h.estado === 'OCUPADA') h.estancia = null; // salida del huésped (el cobro se hace en el sistema)
    cambiarEstado(h, hacia, (b.motivo as string) ?? null);
    return salida({ ok: true });
  }

  const pisoPlano = m(/^\/hospedaje\/plano\/pisos\/(\d+)$/);
  if (pisoPlano && metodo === 'PUT') {
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

  if (ruta === '/hospedaje/plano/pisos' && metodo === 'POST') {
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
    const modelo = masComun ? { amenidades: masComun.split(',') } : null;
    const numeros = d.habitaciones.map((r, i) => {
      const n = `${numero}${String(i + 1).padStart(2, '0')}`;
      db.habs.push({ id: id(), pisoId: piso.id, numero: n, descripcion: null, tipoId: Number(b.tipoHabitacionId), estado: 'DESOCUPADA', ...r, amenidades: [...(modelo?.amenidades ?? [])], activo: true, estancia: null, historial: [] });
      return n;
    });
    return salida({ ...piso, habitaciones: numeros });
  }

  if (ruta === '/hospedaje/habitaciones' && metodo === 'POST') {
    if (db.habs.some((h) => h.numero === b.numero)) return error(409, `Ya existe la habitación ${b.numero} en esta sucursal`);
    const r = (b.plano as { x: number; y: number; ancho: number; alto: number }) ?? { x: 0, y: 0, ancho: 3, alto: 2 };
    const h: Hab = { id: id(), pisoId: Number(b.pisoId), numero: String(b.numero), descripcion: null, tipoId: Number(b.tipoHabitacionId), estado: 'DESOCUPADA', ...r, amenidades: (b.amenidades as string[]) ?? [], activo: true, estancia: null, historial: [] };
    db.habs.push(h);
    return salida(h);
  }

  const hab = m(/^\/hospedaje\/habitaciones\/(\d+)$/);
  if (hab && metodo === 'PATCH') {
    const h = db.habs.find((x) => x.id === Number(hab[1]))!;
    if (b.activo === false && h.estado === 'OCUPADA') return error(409, 'La habitación está ocupada; haz el check-out antes de desactivarla');
    if (typeof b.numero === 'string') h.numero = b.numero;
    if (typeof b.tipoHabitacionId === 'number') h.tipoId = b.tipoHabitacionId;
    if (typeof b.activo === 'boolean') h.activo = b.activo;
    return salida(h);
  }

  const amen = m(/^\/hospedaje\/habitaciones\/(\d+)\/amenidades$/);
  if (amen) {
    const h = db.habs.find((x) => x.id === Number(amen[1]))!;
    const destino = b.aplicarATipo ? db.habs.filter((x) => x.activo && x.tipoId === h.tipoId) : [h];
    for (const x of destino) x.amenidades = [...(b.amenidades as string[])];
    return salida({ habitaciones: destino.length, amenidades: b.amenidades });
  }

  if (ruta === '/hospedaje/amenidades' && metodo === 'POST') {
    const nombre = String(b.nombre).trim();
    const codigo = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (db.amenidades.some((a) => a.codigo === codigo)) return error(409, `Ya existe la comodidad «${nombre}»`);
    const a: Amenidad = { id: id(), codigo, nombre, icono: String(b.icono), activo: true, habitaciones: 0 };
    db.amenidades.push(a);
    return salida(a);
  }

  if (ruta === '/clientes' && metodo === 'POST') {
    const tipos = R<Array<{ id: number; abreviatura: string }>>('/clientes/tipos-documento');
    const t = tipos.find((x) => x.id === b.tipoDocumentoId);
    const numero = String(b.numeroDocumento ?? '').toUpperCase();
    if (t?.abreviatura === 'DNI' && !/^\d{8}$/.test(numero)) return error(400, 'El DNI tiene 8 dígitos');
    const nombre = (b.razonSocial as string) || `${b.nombres ?? ''} ${b.apellidos ?? ''}`.trim();
    if (!nombre) return error(400, 'Escribe nombres y apellidos');
    const c: Cliente = { id: id(), documento: `${t?.abreviatura ?? 'DOC'} ${numero}`, nombre, telefono: (b.telefono as string) || null, pais: String(b.pais ?? 'PE') };
    db.clientes.push(c);
    return salida(c);
  }

  if (ruta === '/reservas' && metodo === 'POST') return salida(crearReserva(b));
  const acc = m(/^\/reservas\/(\d+)\/(confirmar|cancelar|no-show|checkin)$/);
  if (acc) {
    const r = db.reservas.find((x) => x.id === Number(acc[1]));
    if (!r) return error(404, 'La reserva no existe');
    return salida(accionReserva(r, acc[2], b));
  }

  return error(403, SOLO_SISTEMA);
}
