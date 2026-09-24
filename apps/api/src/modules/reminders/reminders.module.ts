import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module.js';
import { RemindersService } from './reminders.service.js';

@Module({
  imports: [BookingModule],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
