import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppException } from './errors.js';

interface Entry {
  bodyHash: string;
  result: unknown;
  expiresAt: number;
}

/**
 * Idempotency-Key para POST de citas, reservas y cobros (docs/05-api.md §1): repetir la misma
 * petición (doble clic, reintento de red) devuelve el mismo resultado sin crear duplicados.
 * F1: en memoria por 24 h; al escalar se mueve a Redis con la misma interfaz.
 */
@Injectable()
export class IdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<unknown>>();

  async run<T>(scope: string, key: string | undefined, body: unknown, fn: () => Promise<T>): Promise<T> {
    if (!key) return fn();
    if (!/^[\w-]{8,100}$/.test(key)) throw new AppException(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key inválida');
    const id = `${scope}:${key}`;
    const bodyHash = createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
    const now = Date.now();

    const cached = this.entries.get(id);
    if (cached && cached.expiresAt > now) {
      if (cached.bodyHash !== bodyHash) {
        throw new AppException(409, 'IDEMPOTENCY_CONFLICT', 'La clave de idempotencia ya se usó con otros datos');
      }
      return cached.result as T;
    }
    const inFlight = this.pending.get(id);
    if (inFlight) return inFlight as Promise<T>;

    const promise = fn().then((result) => {
      this.entries.set(id, { bodyHash, result, expiresAt: now + 86_400_000 });
      return result;
    });
    this.pending.set(id, promise);
    try {
      return await promise;
    } finally {
      this.pending.delete(id);
      if (this.entries.size > 10_000) {
        for (const [k, e] of this.entries) if (e.expiresAt <= now) this.entries.delete(k);
      }
    }
  }
}
