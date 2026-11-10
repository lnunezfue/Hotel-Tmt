import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { filter, Observable, Subject } from 'rxjs';
import { leerConfigRedis } from '../../../config';
import { AvisoTablero, canalDe, leerAviso, mensajeDe, PATRON_CANALES } from '../domain/aviso-tablero';
import { NotificadorTablero } from '../domain/notificador-tablero.port';

/**
 * Reparte los avisos del tablero entre réplicas con Redis pub/sub (S-05 D3, spec §4.3).
 *
 * - Publicadora: conecta al arrancar y no encola: con Redis caído, `publicar` rechaza de inmediato en lugar de
 *   retrasar la petición que originó el aviso; el navegador lo recupera con su consulta de respaldo.
 * - Suscriptora: conecta con el primer flujo (el trabajador nunca abre uno) y usa un solo PSUBSCRIBE por proceso;
 *   ioredis la vuelve a suscribir sola tras una reconexión.
 */
@Injectable()
export class NotificadorTableroRedis implements NotificadorTablero, OnModuleDestroy {
  private readonly logger = new Logger(NotificadorTableroRedis.name);
  private readonly avisos = new Subject<AvisoTablero>();
  private readonly pub: Redis;
  private readonly sub: Redis;
  private suscrita = false;
  private abiertos = 0;

  constructor() {
    const { url } = leerConfigRedis();
    this.pub = new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    this.sub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    this.vigilar(this.pub, 'publicación');
    this.vigilar(this.sub, 'suscripción');
    this.sub.on('pmessage', (_patron: string, canal: string, mensaje: string) => {
      const aviso = leerAviso(canal, mensaje);
      if (aviso) this.avisos.next(aviso);
    });
  }

  async publicar(aviso: AvisoTablero): Promise<void> {
    await this.pub.publish(canalDe(aviso.sucursalId), mensajeDe(aviso));
  }

  escuchar(sucursalId: number): Observable<AvisoTablero> {
    return new Observable<AvisoTablero>((destino) => {
      this.suscribir();
      this.abiertos++;
      const s = this.avisos.pipe(filter((a) => a.sucursalId === sucursalId)).subscribe(destino);
      return () => {
        this.abiertos--;
        s.unsubscribe();
      };
    });
  }

  /** Flujos suscritos ahora mismo en este proceso. */
  get flujosAbiertos(): number {
    return this.abiertos;
  }

  onModuleDestroy(): void {
    this.avisos.complete(); // termina los flujos abiertos antes de que se cierre el servidor HTTP
    this.pub.disconnect();
    this.sub.disconnect();
  }

  private suscribir(): void {
    if (this.suscrita) return;
    this.suscrita = true;
    this.sub.psubscribe(PATRON_CANALES).catch((e: unknown) => {
      this.suscrita = false;
      this.logger.warn(`No se pudo suscribir a los avisos del tablero: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  /** Sin manejador de 'error', ioredis tumba el proceso. Se registra una vez por caída, no en cada reintento. */
  private vigilar(cliente: Redis, rol: string): void {
    let caido = false;
    cliente.on('error', (e: Error) => {
      if (caido) return;
      caido = true;
      this.logger.warn(`Redis (${rol}) no disponible: ${e.message}`);
    });
    cliente.on('ready', () => {
      if (caido) this.logger.log(`Redis (${rol}) disponible de nuevo`);
      caido = false;
    });
  }
}
