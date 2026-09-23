import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller.js';
import { AvailabilityService } from './availability.service.js';
import { HoldStore } from './hold-store.js';

@Module({
  controllers: [AvailabilityController],
  providers: [AvailabilityService, HoldStore],
  exports: [AvailabilityService, HoldStore],
})
export class AvailabilityModule {}
