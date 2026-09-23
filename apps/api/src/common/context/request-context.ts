import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '../auth-user.js';

/** Datos de la petición en curso, disponibles en cualquier capa (auditoría, logs). */
export interface RequestContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  user?: AuthUser;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  storage.run(
    { requestId, ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null },
    () => next(),
  );
}
