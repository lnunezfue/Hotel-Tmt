import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { describirError } from '../../../common/describir-error';
import { MotivoAviso } from '../domain/aviso-tablero';
import { NOTIFICADOR_TABLERO, NotificadorTablero } from '../domain/notificador-tablero.port';

/** Plazo para publicar un aviso: con Redis conectado pero sin responder, la petición no espera más que esto. */
export const ESPERA_PUBLICAR_MS = 1000;

/**
 * Avisa a los tableros abiertos de que algo cambió. Se llama después de confirmar el cambio y nunca rechaza
 * (S-05 D4): si el aviso se pierde, el navegador lo recupera con su consulta de respaldo.
 */
@Injectable()
export class AvisosTablero {
  private readonly logger = new Logger(AvisosTablero.name);

  constructor(
    @Inject(NOTIFICADOR_TABLERO) private readonly notificador: NotificadorTablero,
    private readonly prisma: PrismaService,
  ) {}

  async avisar(sucursalId: number, motivo: MotivoAviso): Promise<void> {
    let reloj: NodeJS.Timeout | undefined;
    const vencido = new Promise<never>((_, rechazar) => {
      reloj = setTimeout(() => rechazar(new Error(`sin respuesta en ${ESPERA_PUBLICAR_MS} ms`)), ESPERA_PUBLICAR_MS);
    });
    try {
      // `publicar` puede lanzar de forma síncrona: se envuelve para que la carrera lo trate como un rechazo más.
      await Promise.race([Promise.resolve().then(() => this.notificador.publicar({ sucursalId, motivo })), vencido]);
    } catch (e) {
      this.logger.warn(`No se pudo avisar al tablero de la sucursal ${sucursalId} (${motivo}): ${describirError(e)}`);
    } finally {
      clearTimeout(reloj);
    }
  }

  /** Para cambios de datos de empresa que se ven en el tablero de todas sus sucursales (p. ej. el tipo de habitación). */
  async avisarEmpresa(empresaId: number, motivo: MotivoAviso): Promise<void> {
    let sucursales: Array<{ id: number }>;
    try {
      sucursales = await this.prisma.sucursal.findMany({ where: { empresa_id: empresaId }, select: { id: true } });
    } catch (e) {
      this.logger.warn(`No se pudo avisar a los tableros de la empresa ${empresaId} (${motivo}): ${describirError(e)}`);
      return;
    }
    await Promise.all(sucursales.map((s) => this.avisar(s.id, motivo))); // en paralelo: los plazos no se suman
  }
}
