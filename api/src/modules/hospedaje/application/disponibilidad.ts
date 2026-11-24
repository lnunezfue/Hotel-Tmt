import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReglaClienteError } from '../domain/cliente';
import { EstadoEstanciaError, ReglaEstanciaError } from '../domain/estancia';
import { EstadoReservaError, RESERVA_VIGENTE, ReglaReservaError } from '../domain/reserva';

/**
 * Cruces de horario de una habitación (RF-RES-18, spec S-06 «Disponibilidad»). Se consulta dentro de la
 * transacción y después de `bloquearHabitaciones`, de modo que dos recepcionistas no tomen la misma habitación.
 */
export async function bloquearHabitaciones(tx: Prisma.TransactionClient, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM habitacion WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
}

export interface Cruce {
  habitacionId: number;
  numero: string;
  /** `R-2026-000001` si choca con una reserva; null si choca con una estancia. */
  reserva: string | null;
}

export async function cruces(
  tx: Prisma.TransactionClient,
  ids: number[],
  inicio: Date,
  fin: Date,
  excluir: { reservaHabitacionId?: bigint; estanciaId?: bigint } = {},
  ahora: Date = new Date(),
): Promise<Cruce[]> {
  if (ids.length === 0) return [];
  const reservadas = await tx.reserva_habitacion.findMany({
    where: {
      habitacion_id: { in: ids },
      estado: 'ACTIVA',
      reserva: { estado: { in: RESERVA_VIGENTE } },
      estancia: { none: {} }, // desde el check-in bloquea la estancia
      fecha_entrada: { lt: fin },
      fecha_salida: { gt: inicio },
      ...(excluir.reservaHabitacionId !== undefined && { id: { not: excluir.reservaHabitacionId } }),
    },
    select: { habitacion_id: true, habitacion: { select: { numero: true } }, reserva: { select: { codigo: true } } },
  });
  // Una estancia activa ocupa la habitación al menos hasta ahora, aunque su salida prevista ya haya pasado.
  const ocupadas = await tx.estancia.findMany({
    where: {
      habitacion_id: { in: ids },
      estado: 'ACTIVA',
      checkin_at: { lt: fin },
      ...(inicio >= ahora && { checkout_previsto: { gt: inicio } }),
      ...(excluir.estanciaId !== undefined && { id: { not: excluir.estanciaId } }),
    },
    select: { habitacion_id: true, habitacion: { select: { numero: true } } },
  });
  return [
    ...reservadas.map((r) => ({ habitacionId: r.habitacion_id, numero: r.habitacion.numero, reserva: r.reserva.codigo })),
    ...ocupadas.map((e) => ({ habitacionId: e.habitacion_id, numero: e.habitacion.numero, reserva: null })),
  ];
}

export function mensajeCruce(c: Cruce): string {
  return c.reserva
    ? `La habitación ${c.numero} ya está reservada en ese horario (${c.reserva})`
    : `La habitación ${c.numero} está ocupada en ese horario`;
}

export async function exigirSinCruces(...args: Parameters<typeof cruces>): Promise<void> {
  const lista = await cruces(...args);
  if (lista.length > 0) throw new ConflictException(mensajeCruce(lista[0]));
}

/** Reglas de dominio → 400; estado que no admite la acción y triggers de solape (última defensa) → 409. */
export function traducirReglas(e: unknown): never {
  if (e instanceof EstadoReservaError || e instanceof EstadoEstanciaError) throw new ConflictException(e.message);
  if (e instanceof ReglaClienteError || e instanceof ReglaReservaError || e instanceof ReglaEstanciaError) throw new BadRequestException(e.message);
  const texto = e instanceof Error ? e.message : '';
  if (/ya está reservada en ese rango|está ocupada en ese horario/.test(texto)) {
    throw new ConflictException('La habitación ya está tomada en ese horario; vuelve a cargar la disponibilidad');
  }
  throw e;
}
