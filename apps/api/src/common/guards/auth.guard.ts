import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@naturalspa/shared';
import type { Request } from 'express';
import { AuthUserLoader } from '../../modules/auth/auth-user.loader.js';
import { TokenService } from '../../modules/auth/token.service.js';
import { AppException, Errors } from '../errors.js';
import type { AuthUser } from '../auth-user.js';
import { currentContext } from '../context/request-context.js';
import { AUTHENTICATED_KEY, PERMISSIONS_KEY, PUBLIC_KEY } from '../decorators.js';

export const ALLOW_PENDING_PASSWORD_KEY = 'naturalspa:allow-pending-password';

/**
 * Guard global: autenticación + RBAC. Deniega por defecto: todo endpoint debe declarar
 * @Public(), @Authenticated() o @RequirePermission(...) (docs/11-seguridad-auditoria.md §19.3).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly users: AuthUserLoader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);
    const authenticatedOnly = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets);
    if (!required?.length && !authenticatedOnly) throw Errors.forbidden();

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw Errors.unauthenticated();

    const claims = await this.tokens.verifyAccessToken(token);
    const user = claims && (await this.users.load(claims.sub, claims.sid));
    if (!user) throw Errors.unauthenticated('La sesión expiró o fue cerrada');

    req.user = user;
    const ctx = currentContext();
    if (ctx) ctx.user = user;

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, targets);
    if (user.mustChangePassword && !allowPending) {
      throw new AppException(403, 'PASSWORD_CHANGE_REQUIRED', 'Debes cambiar tu contraseña para continuar');
    }
    if (user.mfaSetupRequired && !allowPending) {
      throw new AppException(403, 'MFA_SETUP_REQUIRED', 'Configura la verificación en dos pasos para continuar');
    }

    if (required?.length && !required.some((p) => user.permissions.has(p))) {
      throw Errors.forbidden();
    }
    return true;
  }
}
