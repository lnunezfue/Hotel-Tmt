import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Cruces de horario de una habitación entre reservas y estancias (RF-RES-18). Los triggers de la base solo comparan
 * reservas con reservas y estancias con estancias; aquí se cruzan ambas. Se usa dentro de la transacción, después
 * de `bloquearHabitaciones`, para que dos recepcionistas no tomen la misma habitación a la vez.
 */
export async function bloquearHabitaciones(tx: Prisma.TransactionClient, ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM habitacion WHERE id IN (${Prisma.join([...new Set(ids)])}) ORDER BY id FOR UPDATE`;
}

export interface Cruce {
  habitacionId: number;
  numero: string;
  /** Código de la reserva con la que choca, o null si choca con una estancia. */
  reserva: string | null;
}

export async function cruces(
  tx: Prisma.TransactionClient,
  ids: number[],
  inicio: Date,
  fin: Date,
  excluir: { reservaId?: bigint; estanciaId?: bigint } = {},
  ahora: Date = new Date(),
): Promise<Cruce[]> {
  if (ids.length === 0) return [];
  // Reservas por llegar: una habitación de reserva que ya hizo su check-in la representa su estancia.
  const reservadas = await tx.reserva_habitacion.findMany({
    where: {
      habitacion_id: { in: ids },
      estado: 'ACTIVA',
      reserva: { estado: { in: ['PENDIENTE', 'CONFIRMADA'] }, ...(excluir.reservaId !== undefined && { id: { not: excluir.reservaId } }) },
      estancia: { none: {} },
      fecha_entrada: { lt: fin },
      fecha_salida: { gt: inicio },
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

export async function exigirSinCruces(...args: Parameters<typeof cruces>): Promise<void> {
  const [c] = await cruces(...args);
  if (c) {
    throw new ConflictException(
      c.reserva ? `La habitación ${c.numero} ya está reservada en ese horario (${c.reserva})` : `La habitación ${c.numero} está ocupada en ese horario`,
    );
  }
}

/** Un huésped no puede estar alojado en dos habitaciones a la vez. */
export async function exigirNoAlojados(tx: Prisma.TransactionClient, clienteIds: Array<bigint | number>, excluirEstanciaId?: bigint): Promise<void> {
  const alojado = await tx.estancia_huesped.findFirst({
    where: {
      cliente_id: { in: clienteIds.map((x) => BigInt(x)) },
      estancia: { estado: 'ACTIVA', ...(excluirEstanciaId !== undefined && { id: { not: excluirEstanciaId } }) },
    },
    include: { cliente: { select: { nombre_completo: true, razon_social: true } }, estancia: { select: { habitacion: { select: { numero: true } } } } },
  });
  if (alojado) {
    throw new ConflictException(`${alojado.cliente.nombre_completo ?? alojado.cliente.razon_social} ya está alojado en la habitación ${alojado.estancia.habitacion.numero}`);
  }
}
