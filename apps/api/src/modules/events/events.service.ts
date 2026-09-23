import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export type LiveEventType = 'appointment.changed' | 'schedule.changed';

/**
 * Evento en tiempo real (docs/03-arquitectura-stack.md §7.9). Solo lleva identificadores: cada
 * pantalla vuelve a pedir los datos con sus propios permisos, así el canal nunca filtra información.
 */
export interface LiveEvent {
  type: LiveEventType;
  organizationId: string;
  appointmentId?: string;
  /** Colaboradoras afectadas; vacío + `allStaff` = toda la sede (ej. un bloqueo general). */
  staffIds: string[];
  allStaff?: boolean;
}

/** Bus de eventos en memoria (una instancia). Al escalar horizontalmente se reemplaza por Redis pub/sub. */
@Injectable()
export class EventsService {
  readonly stream = new Subject<LiveEvent>();

  publish(event: LiveEvent) {
    this.stream.next(event);
  }

  appointmentChanged(organizationId: string, appointmentId: string, staffIds: string[]) {
    this.publish({ type: 'appointment.changed', organizationId, appointmentId, staffIds: [...new Set(staffIds)] });
  }

  scheduleChanged(organizationId: string, staffId: string | null) {
    this.publish({ type: 'schedule.changed', organizationId, staffIds: staffId ? [staffId] : [], allStaff: !staffId });
  }
}
