import { Global, Module } from '@nestjs/common';
import { MailService } from '../infrastructure/mail/mail.service.js';
import { IdempotencyStore } from './idempotency.js';
import { RateLimiter } from './rate-limiter.js';

@Global()
@Module({
  providers: [RateLimiter, MailService, IdempotencyStore],
  exports: [RateLimiter, MailService, IdempotencyStore],
})
export class CommonModule {}
