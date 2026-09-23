import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [AvailabilityModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
