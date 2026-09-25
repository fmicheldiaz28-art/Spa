import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type AuthUser, displayName } from '../../common/auth-user.js';
import { currentContext } from '../../common/context/request-context.js';
import { AppException, Errors } from '../../common/errors.js';
import { env, LOGIN_POLICY } from '../../config/env.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { MailService } from '../../infrastructure/mail/mail.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { dummyVerify, hashPassword, passwordPolicyViolations, verifyPassword } from './password.js';
import { MfaService } from './mfa/mfa.service.js';
import { TokenService } from './token.service.js';

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** Con MFA activo, la contraseña correcta no abre sesión: entrega un token de 5 min para el segundo paso. */
export type LoginResult = { kind: 'tokens'; userId: string } & IssuedTokens | { kind: 'mfa'; mfaToken: string };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly mfa: MfaService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { userRoles: { select: { role: { select: { code: true } } } } },
    });

    if (!user || user.deletedAt) {
      await dummyVerify(password); // mismo tiempo de respuesta exista o no el email
      await this.audit.record({
        action: 'LOGIN_FAILED',
        module: 'auth',
        actor: { type: 'ANONYMOUS' },
        newValues: { email },
        reason: 'Email no registrado',
      });
      throw Errors.invalidCredentials();
    }

    const actor = {
      type: 'USER' as const,
      userId: user.id,
      name: `${user.firstName} ${user.lastName}`.trim(),
      role: user.userRoles[0]?.role.code ?? null,
    };
    const entity = { type: 'User', id: user.id, label: user.email };

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.record({
        action: 'LOGIN_FAILED',
        module: 'auth',
        actor,
        entity,
        organizationId: user.organizationId,
        reason: 'Cuenta bloqueada',
      });
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw Errors.accountLocked(minutes);
    }

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid || user.status !== 'ACTIVE') {
      await this.recordFailure(user, actor, entity, 'LOGIN_FAILED', valid ? `Usuario ${user.status}` : 'Contraseña incorrecta', !valid);
      throw Errors.invalidCredentials();
    }

    if (user.mfaEnabled) return { kind: 'mfa', mfaToken: await this.tokens.signMfaToken(user.id) };
    return { kind: 'tokens', ...(await this.completeLogin(user, actor, entity)) };
  }

  /** Segundo paso del login: código de la app de autenticación o código de recuperación. */
  async loginMfa(mfaToken: string, code: string): Promise<IssuedTokens & { userId: string }> {
    const userId = await this.tokens.verifyMfaToken(mfaToken);
    if (!userId) throw new AppException(401, 'MFA_SESSION_EXPIRED', 'La verificación venció', 'Vuelve a ingresar tu contraseña.');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { userRoles: { select: { role: { select: { code: true } } } } } });
    if (!user || user.deletedAt || user.status !== 'ACTIVE') throw Errors.invalidCredentials();
    const actor = { type: 'USER' as const, userId: user.id, name: `${user.firstName} ${user.lastName}`.trim(), role: user.userRoles[0]?.role.code ?? null };
    const entity = { type: 'User', id: user.id, label: user.email };
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw Errors.accountLocked(Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
    }

    const method = await this.mfa.verifyLogin(user.id, code);
    if (!method) {
      await this.recordFailure(user, actor, entity, 'MFA_FAILED', 'Código de verificación incorrecto', true);
      throw new AppException(401, 'INVALID_MFA_CODE', 'El código no es correcto', 'Revisa que la hora de tu celular sea automática.');
    }
    return this.completeLogin(user, actor, entity, method === 'recovery' ? 'Con código de recuperación' : 'Con verificación en dos pasos');
  }

  /** Intento fallido: suma al contador y bloquea al llegar al límite (docs/11 §19.2). */
  private async recordFailure(
    user: { id: string; organizationId: string | null; failedLoginCount: number },
    actor: NonNullable<Parameters<AuditService['record']>[0]['actor']>,
    entity: { type: string; id: string; label: string },
    action: string,
    reason: string,
    counts: boolean,
  ) {
    const failed = counts ? user.failedLoginCount + 1 : user.failedLoginCount;
    const lock = failed >= LOGIN_POLICY.maxFailedLogins;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOGIN_POLICY.lockoutMinutes * 60_000) : undefined },
      });
      const base = { module: 'auth', actor, entity, organizationId: user.organizationId };
      await this.audit.record({ ...base, action, reason }, tx);
      if (lock) await this.audit.record({ ...base, action: 'ACCOUNT_LOCKED' }, tx);
    });
  }

  private completeLogin(
    user: { id: string; organizationId: string | null },
    actor: NonNullable<Parameters<AuditService['record']>[0]['actor']>,
    entity: { type: string; id: string; label: string },
    reason?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      const issued = await this.createSession(tx, user.id, randomUUID());
      await this.audit.record(
        { action: 'LOGIN', module: 'auth', actor, entity, organizationId: user.organizationId, sessionId: issued.sessionId, reason: reason ?? null },
        tx,
      );
      return { ...issued, userId: user.id };
    });
  }

  /**
   * Rota el refresh token. Si llega un token ya rotado, se asume robo: se revoca toda la familia
   * de sesiones (docs/05-api.md §1.1).
   */
  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: this.tokens.hashRefreshToken(refreshToken) },
      include: { user: { include: { userRoles: { select: { role: { select: { code: true } } } } } } },
    });
    if (!session) throw Errors.unauthenticated();

    const actor = {
      type: 'USER' as const,
      userId: session.userId,
      name: `${session.user.firstName} ${session.user.lastName}`.trim(),
      role: session.user.userRoles[0]?.role.code ?? null,
    };

    if (session.revokedAt) {
      if (session.revokedReason === 'ROTATED') {
        await this.prisma.$transaction(async (tx) => {
          await tx.session.updateMany({
            where: { familyId: session.familyId, revokedAt: null },
            data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
          });
          await this.audit.record(
            {
              action: 'SESSION_HIJACK_SUSPECTED',
              module: 'auth',
              actor,
              organizationId: session.user.organizationId,
              sessionId: session.id,
              reason: 'Reutilización de refresh token ya rotado',
            },
            tx,
          );
        });
      }
      throw Errors.unauthenticated();
    }
    if (session.expiresAt < new Date() || session.user.status !== 'ACTIVE' || session.user.deletedAt) {
      throw Errors.unauthenticated('La sesión expiró');
    }

    return this.prisma.$transaction(async (tx) => {
      const issued = await this.createSession(tx, session.userId, session.familyId);
      await tx.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED', replacedBy: issued.sessionId },
      });
      return issued;
    });
  }

  async logout(user: AuthUser): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: user.sessionId },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      });
      await this.audit.record({ action: 'LOGOUT', module: 'auth', entity: { type: 'User', id: user.id, label: user.email } }, tx);
    });
  }

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string): Promise<void> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verifyPassword(record.passwordHash, currentPassword))) {
      throw new AppException(422, 'INVALID_CURRENT_PASSWORD', 'La contraseña actual no es correcta');
    }
    const violations = passwordPolicyViolations(newPassword);
    if (currentPassword === newPassword) violations.push('Debe ser distinta de la contraseña actual');
    if (violations.length) {
      throw Errors.validation(violations.map((message) => ({ field: 'newPassword', code: 'PASSWORD_POLICY', message })));
    }

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date(), updatedBy: user.id },
      });
      // Cierra las demás sesiones; la actual sigue activa.
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null, id: { not: user.sessionId } },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_CHANGED' },
      });
      await this.audit.record(
        {
          action: 'PASSWORD_CHANGED',
          module: 'auth',
          entity: { type: 'User', id: user.id, label: user.email },
          oldValues: { mustChangePassword: record.mustChangePassword },
          newValues: { mustChangePassword: false },
        },
        tx,
      );
    });
  }

  /**
   * RF-AUTH-03: envía un enlace de un solo uso válido 30 minutos. La respuesta al cliente es la
   * misma exista o no el email (anti enumeración); solo se audita si el usuario existe.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt || user.status !== 'ACTIVE') return;

    const { token, hash } = this.tokens.newRefreshToken();
    await this.prisma.$transaction(async (tx) => {
      // Invalida enlaces anteriores sin usar.
      await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hash,
          expiresAt: new Date(Date.now() + 30 * 60_000),
          requestedIp: currentContext()?.ip ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'PASSWORD_RESET_REQUESTED',
          module: 'auth',
          actor: { type: 'ANONYMOUS' },
          entity: { type: 'User', id: user.id, label: user.email },
          organizationId: user.organizationId,
        },
        tx,
      );
    });

    const link = `${env.WEB_ORIGIN}/restablecer/${token}`;
    await this.mail.send({
      to: user.email,
      subject: 'Restablece tu contraseña de NaturalSpa',
      text: `Hola ${user.firstName}:\n\nPara crear una contraseña nueva abre este enlace (válido 30 minutos):\n${link}\n\nSi no lo solicitaste, ignora este mensaje: tu contraseña no cambiará.`,
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(token) },
      include: { user: true },
    });
    if (!record || record.usedAt || record.expiresAt < new Date() || record.user.status !== 'ACTIVE') {
      throw new AppException(422, 'INVALID_RESET_TOKEN', 'El enlace expiró o ya fue usado', 'Solicita uno nuevo.');
    }
    const violations = passwordPolicyViolations(newPassword);
    if (violations.length) {
      throw Errors.validation(violations.map((message) => ({ field: 'newPassword', code: 'PASSWORD_POLICY', message })));
    }

    const passwordHash = await hashPassword(newPassword);
    const { user } = record;
    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'PASSWORD_RESET' },
      });
      await this.audit.record(
        {
          action: 'PASSWORD_RESET',
          module: 'auth',
          actor: { type: 'USER', userId: user.id, name: `${user.firstName} ${user.lastName}`.trim() },
          entity: { type: 'User', id: user.id, label: user.email },
          organizationId: user.organizationId,
        },
        tx,
      );
    });
  }

  profile(user: AuthUser) {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      name: displayName(user),
      organizationId: user.organizationId,
      roles: user.roles,
      permissions: [...user.permissions].sort(),
      staffId: user.staffId,
      clientId: user.clientId,
      mustChangePassword: user.mustChangePassword,
      mfaSetupRequired: user.mfaSetupRequired,
    };
  }

  private async createSession(tx: Prisma.TransactionClient, userId: string, familyId: string) {
    const { token, hash } = this.tokens.newRefreshToken();
    const ctx = currentContext();
    const refreshExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_HOURS * 3_600_000);
    const session = await tx.session.create({
      data: {
        userId,
        familyId,
        refreshTokenHash: hash,
        userAgent: ctx?.userAgent ?? null,
        ip: ctx?.ip ?? null,
        expiresAt: refreshExpiresAt,
      },
    });
    const accessToken = await this.tokens.signAccessToken({ sub: userId, sid: session.id });
    return {
      sessionId: session.id,
      accessToken,
      expiresIn: env.ACCESS_TOKEN_TTL_SEC,
      refreshToken: token,
      refreshExpiresAt,
    };
  }
}
