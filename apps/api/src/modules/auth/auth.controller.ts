import { Body, Controller, Get, HttpCode, Logger, Post, Req, Res, SetMetadata } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { Authenticated, CurrentUser, Public } from '../../common/decorators.js';
import { Errors } from '../../common/errors.js';
import { ALLOW_PENDING_PASSWORD_KEY } from '../../common/guards/auth.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimiter } from '../../common/rate-limiter.js';
import { isProduction } from '../../config/env.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa/mfa.service.js';

const REFRESH_COOKIE = isProduction ? '__Host-ns_rt' : 'ns_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Email inválido')),
  password: z.string().min(1, 'Ingresa tu contraseña').max(128),
});

// Código TOTP (6 dígitos) o de recuperación (xxxx-xxxx).
const mfaCode = z.string().trim().min(6).max(12);
const mfaLoginSchema = z.object({ mfaToken: z.string().min(20).max(2000), code: mfaCode });
const mfaDisableSchema = z.object({ password: z.string().min(1).max(128), code: mfaCode });

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
});

const forgotSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email('Email inválido')) });

const resetSchema = z.object({
  token: z.string().regex(/^[\w-]{20,100}$/, 'Enlace inválido'),
  newPassword: z.string().min(1).max(128),
});

/** Permite el endpoint aunque el usuario deba cambiar su contraseña. */
const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD_KEY, true);

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly limiter: RateLimiter,
    private readonly mfa: MfaService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Body(new ZodValidationPipe(loginSchema)) dto: z.infer<typeof loginSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    // docs/05-api.md §3: 5/min y 20/h por IP + email
    this.limiter.hit(`login:m:${req.ip}:${dto.email}`, 5, 60_000);
    this.limiter.hit(`login:h:${req.ip}:${dto.email}`, 20, 3_600_000);
    const result = await this.auth.login(dto.email, dto.password);
    if (result.kind === 'mfa') return { mfaRequired: true, mfaToken: result.mfaToken };
    this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Public()
  @Post('login/mfa')
  @HttpCode(200)
  async loginMfa(@Req() req: Request, @Body(new ZodValidationPipe(mfaLoginSchema)) dto: z.infer<typeof mfaLoginSchema>, @Res({ passthrough: true }) res: Response) {
    this.limiter.hit(`login-mfa:m:${req.ip}`, 10, 60_000);
    const issued = await this.auth.loginMfa(dto.mfaToken, dto.code);
    this.setRefreshCookie(res, issued.refreshToken, issued.refreshExpiresAt);
    return { accessToken: issued.accessToken, expiresIn: issued.expiresIn };
  }

  // ------------------------------------------------------------ verificación en dos pasos

  @Authenticated()
  @AllowPendingPassword()
  @Get('mfa')
  mfaStatus(@CurrentUser() user: AuthUser) {
    return this.mfa.status(user);
  }

  @Authenticated()
  @AllowPendingPassword()
  @Post('mfa/setup')
  @HttpCode(200)
  mfaSetup(@CurrentUser() user: AuthUser) {
    return this.mfa.setup(user);
  }

  @Authenticated()
  @AllowPendingPassword()
  @Post('mfa/enable')
  @HttpCode(200)
  mfaEnable(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Código de 6 dígitos') }))) dto: { code: string }) {
    this.limiter.hit(`mfa-enable:${user.id}`, 10, 60_000);
    return this.mfa.enable(user, dto.code);
  }

  @Authenticated()
  @Post('mfa/disable')
  @HttpCode(204)
  async mfaDisable(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(mfaDisableSchema)) dto: z.infer<typeof mfaDisableSchema>) {
    this.limiter.hit(`mfa-disable:${user.id}`, 5, 60_000);
    await this.mfa.disable(user, dto.password, dto.code);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Mitigación CSRF: un formulario externo no puede enviar este header.
    if (req.header('x-requested-with') !== 'fetch') throw Errors.unauthenticated();
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof token !== 'string' || !token) throw Errors.unauthenticated();

    const issued = await this.auth.refresh(token);
    this.setRefreshCookie(res, issued.refreshToken, issued.refreshExpiresAt);
    return { accessToken: issued.accessToken, expiresIn: issued.expiresIn };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  async forgotPassword(@Req() req: Request, @Body(new ZodValidationPipe(forgotSchema)) dto: z.infer<typeof forgotSchema>) {
    this.limiter.hit(`forgot:${dto.email}`, 3, 3_600_000);
    this.limiter.hit(`forgot-ip:${req.ip}`, 10, 3_600_000);
    // En segundo plano: el tiempo de respuesta no revela si el email existe.
    void this.auth.requestPasswordReset(dto.email).catch((err: unknown) => this.logger.error(err));
    return { message: 'Si el email está registrado, te enviamos un enlace para restablecer la contraseña.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(@Req() req: Request, @Body(new ZodValidationPipe(resetSchema)) dto: z.infer<typeof resetSchema>) {
    this.limiter.hit(`reset-ip:${req.ip}`, 10, 3_600_000);
    await this.auth.resetPassword(dto.token, dto.newPassword);
  }

  @Authenticated()
  @AllowPendingPassword()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  @Authenticated()
  @AllowPendingPassword()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user);
  }

  @Authenticated()
  @AllowPendingPassword()
  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: z.infer<typeof changePasswordSchema>,
  ) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
  }

  private setRefreshCookie(res: Response, token: string, expires: Date) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      expires,
    });
  }
}
