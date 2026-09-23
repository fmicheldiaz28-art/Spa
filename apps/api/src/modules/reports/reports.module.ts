import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [AvailabilityModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
