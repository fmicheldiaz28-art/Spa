import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { env } from '../../config/env.js';
import { PrismaClient } from '../../generated/prisma/client.js';
import { createPrismaAdapter } from './create-adapter.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: createPrismaAdapter(env.DATABASE_URL, env.DATABASE_POOL_MAX) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
