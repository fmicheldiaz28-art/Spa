import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'ok', time: new Date().toISOString() };
  }
}
