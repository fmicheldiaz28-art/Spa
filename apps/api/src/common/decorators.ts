import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@naturalspa/shared';
import type { Request } from 'express';
import type { AuthUser } from './auth-user.js';

export const PUBLIC_KEY = 'naturalspa:public';
export const AUTHENTICATED_KEY = 'naturalspa:authenticated';
export const PERMISSIONS_KEY = 'naturalspa:permissions';

/** Endpoint accesible sin sesión. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/** Endpoint que solo requiere sesión válida (ej. /auth/me), sin permiso específico. */
export const Authenticated = () => SetMetadata(AUTHENTICATED_KEY, true);

/** Requiere al menos uno de los permisos indicados. El alcance lo aplica el servicio. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  return req.user!;
});
