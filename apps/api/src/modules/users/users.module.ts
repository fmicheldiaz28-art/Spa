import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RolesController } from './roles.controller.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, RolesController],
  providers: [UsersService],
})
export class UsersModule {}
