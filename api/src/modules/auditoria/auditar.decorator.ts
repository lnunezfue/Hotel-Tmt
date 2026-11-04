import { SetMetadata } from '@nestjs/common';
import { AccionAuditoria } from './domain/acciones';

export const AUDITAR_KEY = 'auditar';
export const Auditar = (accion: AccionAuditoria) => SetMetadata(AUDITAR_KEY, accion);
