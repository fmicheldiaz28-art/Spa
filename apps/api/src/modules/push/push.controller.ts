import { Body, Controller, Delete, Get, Headers, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../../common/auth-user.js';
import { Authenticated, CurrentUser } from '../../common/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RateLimiter } from '../../common/rate-limiter.js';
import { PushService } from './push.service.js';

const b64u = (min: number, max: number) => z.string().regex(/^[\w-]+$/).min(min).max(max);
const subscriptionSchema = z.object({
  // Solo servicios push por HTTPS (Chrome, Firefox, Edge, Safari).
  endpoint: z.url().max(1000).refine((u) => u.startsWith('https://'), 'Endpoint inválido'),
  keys: z.object({ p256dh: b64u(80, 100), auth: b64u(16, 32) }),
});

/** Suscripciones push del dispositivo de quien usa la app. */
@Controller('push')
@Authenticated()
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly limiter: RateLimiter,
  ) {}

  @Get('config')
  config() {
    return this.push.config();
  }

  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(@CurrentUser() user: AuthUser, @Headers('user-agent') ua: string | undefined, @Body(new ZodValidationPipe(subscriptionSchema)) dto: z.infer<typeof subscriptionSchema>) {
    this.limiter.hit(`push-sub:${user.id}`, 20, 3_600_000);
    await this.push.subscribe(user, { endpoint: dto.endpoint, ...dto.keys }, ua?.slice(0, 300) ?? null);
  }

  @Delete('subscriptions')
  @HttpCode(204)
  async unsubscribe(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(z.object({ endpoint: z.string().max(1000) }))) dto: { endpoint: string }) {
    await this.push.unsubscribe(user, dto.endpoint);
  }

  /** Notificación de prueba a los dispositivos propios. */
  @Post('test')
  @HttpCode(200)
  async test(@CurrentUser() user: AuthUser) {
    this.limiter.hit(`push-test:${user.id}`, 5, 600_000);
    const sent = await this.push.sendToUsers([user.id], { title: 'NaturalSpa', body: 'Las notificaciones funcionan en este dispositivo 🌿', url: '/app' });
    return { sent };
  }
}
