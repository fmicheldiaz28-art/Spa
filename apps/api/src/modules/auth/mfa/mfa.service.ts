import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { AuthUser } from '../../../common/auth-user.js';
import { AppException, Errors } from '../../../common/errors.js';
import { env, isProduction } from '../../../config/env.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { resolveSettings } from '../../organization/settings.service.js';
import { verifyPassword } from '../password.js';
import { deriveKey, open, seal } from './secret-box.js';
import { generateRecoveryCodes, generateSecret, normalizeRecoveryCode, otpauthUri, verifyTotp } from './totp.js';

const ISSUER = 'NaturalSpa';
const MFA_ROLES = new Set(['SUPER_ADMIN', 'ADMIN']);
const hashCode = (code: string) => createHash('sha256').update(`naturalspa-recovery:${code}`).digest('hex');

type MfaUser = { id: string; email: string; mfaEnabled: boolean; mfaSecretEnc: Uint8Array | null; mfaLastStep: bigint | null; mfaRecoveryHashes: string[] };

/** Verificación en dos pasos con TOTP (docs/11-seguridad-auditoria.md §30). */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    this.key = deriveKey(env.MFA_ENCRYPTION_KEY, env.JWT_SECRET);
    if (isProduction && !env.MFA_ENCRYPTION_KEY) {
      this.logger.warn('MFA_ENCRYPTION_KEY no está configurada: la clave se deriva de JWT_SECRET (rotarlo invalidaría los secretos MFA)');
    }
  }

  /** ¿La política obliga a esta persona a tener MFA? (ADMIN y SUPER_ADMIN con security.require_mfa_for_admin). */
  async isRequired(roles: readonly string[], organizationId: string | null): Promise<boolean> {
    if (!roles.some((r) => MFA_ROLES.has(r))) return false;
    const org = organizationId
      ? await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { settings: true } })
      : await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { settings: true } });
    return resolveSettings(org?.settings).security.require_mfa_for_admin;
  }

  async status(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { mfaEnabled: true, mfaEnabledAt: true, mfaRecoveryHashes: true } });
    return {
      enabled: u.mfaEnabled,
      enabledAt: u.mfaEnabledAt?.toISOString() ?? null,
      recoveryCodesLeft: u.mfaRecoveryHashes.length,
      required: await this.isRequired(user.roles, user.organizationId),
    };
  }

  /** Paso 1: genera un secreto pendiente y devuelve lo necesario para el QR. */
  async setup(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { mfaEnabled: true } });
    if (u.mfaEnabled) throw new AppException(409, 'MFA_ALREADY_ENABLED', 'La verificación en dos pasos ya está activa');
    const secret = generateSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaSecretEnc: new Uint8Array(seal(this.key, secret)), mfaLastStep: null } });
    const uri = otpauthUri(secret, user.email, ISSUER);
    return { otpauthUri: uri, secret: new URL(uri).searchParams.get('secret')! };
  }

  /** Paso 2: confirma con un código de la app y activa. Devuelve los códigos de recuperación (una sola vez). */
  async enable(user: AuthUser, code: string) {
    const u = await this.load(user.id);
    if (u.mfaEnabled) throw new AppException(409, 'MFA_ALREADY_ENABLED', 'La verificación en dos pasos ya está activa');
    if (!u.mfaSecretEnc) throw new AppException(422, 'MFA_SETUP_REQUIRED', 'Primero genera el código QR');
    const step = verifyTotp(open(this.key, u.mfaSecretEnc), code, Date.now());
    if (step === null) throw new AppException(422, 'INVALID_MFA_CODE', 'El código no es correcto', 'Revisa que la hora de tu celular sea automática.');
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { mfaEnabled: true, mfaEnabledAt: new Date(), mfaLastStep: BigInt(step), mfaRecoveryHashes: recoveryCodes.map(hashCode) },
      });
      await this.audit.record({ action: 'MFA_ENABLED', module: 'auth', entity: { type: 'User', id: user.id, label: user.email } }, tx);
    });
    return { recoveryCodes };
  }

  async disable(user: AuthUser, password: string, code: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!u.mfaEnabled) return;
    if (await this.isRequired(user.roles, user.organizationId)) {
      throw new AppException(422, 'MFA_REQUIRED_BY_POLICY', 'Tu rol requiere la verificación en dos pasos', 'Si cambiaste de celular, pide que te la reinicien.');
    }
    if (!(await verifyPassword(u.passwordHash, password)) || !(await this.check(u, code))) {
      throw new AppException(422, 'INVALID_MFA_CODE', 'La contraseña o el código no son correctos');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryHashes: [] } });
      await this.audit.record({ action: 'MFA_DISABLED', module: 'auth', entity: { type: 'User', id: user.id, label: user.email } }, tx);
    });
  }

  /** Celular perdido: administración quita el MFA de otra persona; deberá configurarlo de nuevo. */
  async reset(actor: AuthUser, targetId: string, reason: string) {
    const target = await this.prisma.user.findFirst({ where: { id: targetId, deletedAt: null }, select: { id: true, email: true, organizationId: true, mfaEnabled: true } });
    if (!target || (actor.organizationId && target.organizationId !== actor.organizationId)) throw Errors.notFound();
    if (target.id === actor.id) throw new AppException(422, 'MFA_SELF_RESET', 'No puedes reiniciar tu propia verificación en dos pasos');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryHashes: [] } });
      // Cierra sus sesiones: quien tenga el celular perdido no conserva acceso.
      await tx.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: 'MFA_RESET' } });
      await this.audit.record({ action: 'MFA_RESET', module: 'users', entity: { type: 'User', id: target.id, label: target.email }, organizationId: target.organizationId, reason }, tx);
    });
  }

  /** Verifica un código TOTP o de recuperación durante el login. Consume el paso o el código usado. */
  async verifyLogin(userId: string, code: string): Promise<'totp' | 'recovery' | null> {
    return this.check(await this.load(userId), code);
  }

  private async check(u: MfaUser, code: string): Promise<'totp' | 'recovery' | null> {
    if (!u.mfaEnabled || !u.mfaSecretEnc) return null;
    const trimmed = code.replace(/\s/g, '');
    if (/^\d{6}$/.test(trimmed)) {
      const step = verifyTotp(open(this.key, u.mfaSecretEnc), trimmed, Date.now(), u.mfaLastStep === null ? null : Number(u.mfaLastStep));
      if (step === null) return null;
      // Condicional: si otra petición usó el mismo paso en paralelo, solo una gana.
      const { count } = await this.prisma.user.updateMany({
        where: { id: u.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: BigInt(step) } }] },
        data: { mfaLastStep: BigInt(step) },
      });
      return count ? 'totp' : null;
    }
    const hash = hashCode(normalizeRecoveryCode(trimmed));
    if (!u.mfaRecoveryHashes.includes(hash)) return null;
    const { count } = await this.prisma.user.updateMany({
      where: { id: u.id, mfaRecoveryHashes: { has: hash } },
      data: { mfaRecoveryHashes: u.mfaRecoveryHashes.filter((h) => h !== hash) },
    });
    return count ? 'recovery' : null;
  }

  private load(userId: string): Promise<MfaUser> {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, mfaEnabled: true, mfaSecretEnc: true, mfaLastStep: true, mfaRecoveryHashes: true },
    });
  }
}
