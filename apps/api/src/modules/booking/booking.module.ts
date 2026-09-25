import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module.js';
import { WaitlistModule } from '../waitlist/waitlist.module.js';
import { BookingController } from './booking.controller.js';
import { BookingService } from './booking.service.js';
import { ClientTokenService } from './client-token.service.js';

@Module({
  imports: [AvailabilityModule, WaitlistModule],
  controllers: [BookingController],
  providers: [BookingService, ClientTokenService],
  exports: [ClientTokenService],
})
export class BookingModule {}
