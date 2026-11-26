import 'dotenv/config';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Las pruebas de integración se escribieron con las reglas de siempre (salida 12:00, sin topes por franja, cobro al
 * salir). El seed configura la operación real en Hotel Centro, así que se aparta mientras corren y se devuelve al
 * terminar; test/operacion.e2e-spec.ts la configura por su cuenta.
 */
const ARCHIVO = join(tmpdir(), 'hotel-e2e-operacion.json');

export async function apartarOperacion(): Promise<void> {
  const prisma = new PrismaService();
  try {
    const operaciones = await prisma.sucursal_operacion.findMany();
    const franjas = await prisma.sucursal_franja_salida.findMany();
    // Si una corrida anterior se cortó sin devolverla, el respaldo de esa corrida es el bueno
    if (operaciones.length || !existsSync(ARCHIVO)) writeFileSync(ARCHIVO, JSON.stringify({ operaciones, franjas }));
    await prisma.sucursal_franja_salida.deleteMany();
    await prisma.sucursal_operacion.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
}

export async function devolverOperacion(): Promise<void> {
  if (!existsSync(ARCHIVO)) return;
  const { operaciones, franjas } = JSON.parse(readFileSync(ARCHIVO, 'utf8')) as {
    operaciones: Array<Record<string, unknown>>;
    franjas: Array<Record<string, unknown>>;
  };
  const fecha = (v: unknown) => new Date(v as string);
  const prisma = new PrismaService();
  try {
    await prisma.sucursal_franja_salida.deleteMany();
    await prisma.sucursal_operacion.deleteMany();
    for (const o of operaciones) {
      await prisma.sucursal_operacion.create({
        data: {
          sucursal_id: o.sucursal_id as number, cobro_al_ingreso: o.cobro_al_ingreso as boolean, vende_consumos: o.vende_consumos as boolean,
          minutos_limpieza: o.minutos_limpieza as number, hora_salida_noche: fecha(o.hora_salida_noche), turno_sugerido_id: o.turno_sugerido_id as number | null,
        },
      });
    }
    for (const f of franjas) {
      await prisma.sucursal_franja_salida.create({
        data: { sucursal_id: f.sucursal_id as number, nombre: f.nombre as string, desde: fecha(f.desde), hasta: fecha(f.hasta), salida_maxima: fecha(f.salida_maxima), dias_despues: f.dias_despues as number },
      });
    }
    rmSync(ARCHIVO);
  } finally {
    await prisma.$disconnect();
  }
}
