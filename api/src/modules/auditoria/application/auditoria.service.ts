import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { contextoActual } from '../../../common/contexto-peticion';
import { AccionAuditoria } from '../domain/acciones';
import { sanitizar } from '../domain/sanitizar';

export interface RegistroAuditoria {
  accion: AccionAuditoria;
  tabla: string;
  registroId: bigint | number | null;
  antes?: unknown;
  despues?: unknown;
  usuarioId?: number | null;
}

function aJson(valor: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const limpio = sanitizar(valor);
  return limpio === undefined || limpio === null ? Prisma.DbNull : (limpio as Prisma.InputJsonValue);
}

@Injectable()
export class AuditoriaService {
  /** Inserta con el cliente de la transacción recibida: la auditoría se confirma o se revierte junto con el cambio. */
  async registrar(tx: Prisma.TransactionClient, r: RegistroAuditoria): Promise<void> {
    const ctx = contextoActual();
    await tx.auditoria.create({
      data: {
        usuario_id: r.usuarioId !== undefined ? r.usuarioId : (ctx?.usuarioId ?? null),
        sucursal_id: ctx?.sucursalId ?? null,
        tabla: r.tabla,
        registro_id: r.registroId === null ? null : BigInt(r.registroId),
        accion: r.accion,
        datos_antes: aJson(r.antes),
        datos_despues: aJson(r.despues),
        ip: ctx?.ip ?? null,
        user_agent: ctx?.userAgent ?? null,
      },
    });
    ctx?.registros.push(r.accion);
  }
}
