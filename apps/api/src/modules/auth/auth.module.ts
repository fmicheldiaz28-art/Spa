import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthUserLoader } from './auth-user.loader.js';
import { MfaService } from './mfa/mfa.service.js';
import { TokenService } from './token.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TokenService, AuthUserLoader, MfaService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [MfaService],
})
export class AuthModule {}
