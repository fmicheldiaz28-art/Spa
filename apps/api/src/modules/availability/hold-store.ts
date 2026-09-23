import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface Hold {
  id: string;
  serviceId: string;
  staffId: string;
  startAt: Date;
  /** Fin del bloqueo: servicio + preparación. */
  blockedUntil: Date;
  expiresAt: number;
}

/**
 * Retención temporal de un horario mientras la clienta completa la reserva (RF-RES-04).
 * F1: en memoria con TTL; al escalar se mueve a Redis (SET NX PX) con la misma interfaz.
 * La restricción EXCLUDE de la base sigue siendo la garantía final.
 */
@Injectable()
export class HoldStore {
  private readonly holds = new Map<string, Hold>();

  create(input: Omit<Hold, 'id' | 'expiresAt'>, ttlMs: number): Hold {
    this.sweep();
    const hold = { ...input, id: randomUUID(), expiresAt: Date.now() + ttlMs };
    this.holds.set(hold.id, hold);
    return hold;
  }

  get(id: string): Hold | null {
    const h = this.holds.get(id);
    if (!h || h.expiresAt <= Date.now()) {
      this.holds.delete(id);
      return null;
    }
    return h;
  }

  release(id: string) {
    this.holds.delete(id);
  }

  /** Retenciones vigentes que ocupan la agenda de esas colaboradoras en el rango. */
  active(staffIds: string[], from: Date, to: Date, excludeId?: string): Hold[] {
    this.sweep();
    return [...this.holds.values()].filter((h) => h.id !== excludeId && staffIds.includes(h.staffId) && h.startAt < to && h.blockedUntil > from);
  }

  private sweep() {
    const now = Date.now();
    for (const [id, h] of this.holds) if (h.expiresAt <= now) this.holds.delete(id);
  }
}
