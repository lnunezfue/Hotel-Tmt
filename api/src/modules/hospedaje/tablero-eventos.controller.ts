import { Controller, Inject, Sse } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { UsuarioActual, UsuarioAutenticado } from '../../common/usuario-actual.decorator';
import { EventoFlujo, flujoTablero } from './application/flujo-tablero';
import { NOTIFICADOR_TABLERO, NotificadorTablero } from './domain/notificador-tablero.port';

@ApiTags('hospedaje')
@Controller('hospedaje')
export class TableroEventosController {
  constructor(@Inject(NOTIFICADOR_TABLERO) private readonly notificador: NotificadorTablero) {}

  /**
   * Avisos de cambios en el tablero de la sucursal del token (RF-RES-05, spec S-05 §4.1). El guard global ya
   * validó la cookie; el flujo termina cuando vence ese acceso y el navegador reabre con el renovado.
   */
  @Sse('tablero/eventos')
  eventos(@UsuarioActual() u: UsuarioAutenticado): Observable<EventoFlujo> {
    return flujoTablero(this.notificador.escuchar(u.sucursalId), u.exp * 1000 - Date.now());
  }
}
