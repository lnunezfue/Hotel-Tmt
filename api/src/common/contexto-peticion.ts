import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export interface ContextoPeticion {
  usuarioId: number | null;
  sucursalId: number | null;
  ip: string | null;
  userAgent: string | null;
  registros: string[];
}

const almacen = new AsyncLocalStorage<ContextoPeticion>();

export function contextoActual(): ContextoPeticion | undefined {
  return almacen.getStore();
}

export function middlewareContexto(req: Request, _res: Response, next: NextFunction): void {
  const ctx: ContextoPeticion = {
    usuarioId: null,
    sucursalId: null,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
    registros: [],
  };
  almacen.run(ctx, () => next());
}
