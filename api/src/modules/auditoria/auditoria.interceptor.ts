import { CallHandler, ExecutionContext, Injectable, InternalServerErrorException, Logger, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { contextoActual } from '../../common/contexto-peticion';
import { AUDITAR_KEY } from './auditar.decorator';
import { AccionAuditoria } from './domain/acciones';

/** Verifica que todo endpoint marcado con @Auditar haya registrado su acción antes de responder con éxito. */
@Injectable()
export class AuditoriaInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditoriaInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const accion = this.reflector.getAllAndOverride<AccionAuditoria | undefined>(AUDITAR_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!accion) return next.handle();
    return next.handle().pipe(
      tap(() => {
        if (contextoActual()?.registros.includes(accion)) return;
        const mensaje = `Falta registrar la auditoría de ${accion}`;
        if (process.env.NODE_ENV !== 'production') throw new InternalServerErrorException(mensaje);
        this.logger.error(mensaje);
      }),
    );
  }
}
