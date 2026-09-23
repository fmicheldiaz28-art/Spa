import { Controller, type MessageEvent, Sse } from '@nestjs/common';
import { filter, from, interval, map, merge, type Observable, switchMap, takeUntil, timer } from 'rxjs';
import { type AuthUser, can } from '../../common/auth-user.js';
import { CurrentUser, RequirePermission } from '../../common/decorators.js';
import { resolveOrganizationId } from '../../common/org.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { EventsService } from './events.service.js';

/** El stream se cierra junto con la vigencia del access token; el cliente se reconecta con uno nuevo. */
const MAX_STREAM_MS = 15 * 60_000;

@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly prisma: PrismaService,
  ) {}

  @Sse()
  @RequirePermission('appointments.read_all', 'appointments.read_own')
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    const all = can(user, 'appointments.read_all');
    return from(resolveOrganizationId(this.prisma, user)).pipe(
      switchMap((organizationId) =>
        merge(
          interval(25_000).pipe(map((): MessageEvent => ({ type: 'ping', data: {} }))),
          this.events.stream.pipe(
            // Salas por alcance: la especialista solo recibe lo que la involucra (docs §7.9).
            filter((e) => e.organizationId === organizationId && (all || e.allStaff === true || (!!user.staffId && e.staffIds.includes(user.staffId)))),
            map((e): MessageEvent => ({ type: e.type, data: { appointmentId: e.appointmentId ?? null } })),
          ),
        ),
      ),
      takeUntil(timer(MAX_STREAM_MS)),
    );
  }
}
