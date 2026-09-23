import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthUserLoader } from './auth-user.loader.js';
import { TokenService } from './token.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, TokenService, AuthUserLoader, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
