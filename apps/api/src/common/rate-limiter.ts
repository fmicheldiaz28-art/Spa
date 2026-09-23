import { Injectable } from '@nestjs/common';
import { AppException } from './errors.js';

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Límite de peticiones por ventana fija (docs/05-api.md §3).
 * F1: en memoria (una sola instancia del API). Al escalar horizontalmente se reemplaza por Redis
 * manteniendo la misma interfaz.
 */
@Injectable()
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  /** Registra un intento; lanza 429 si se supera `limit` en `windowMs`. */
  hit(key: string, limit: number, windowMs: number): void {
    const now = Date.now();
    this.sweep(now);
    const current = this.windows.get(key);
    const window = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowMs };
    window.count += 1;
    this.windows.set(key, window);
    if (window.count > limit) {
      const seconds = Math.ceil((window.resetAt - now) / 1000);
      throw new AppException(
        429,
        'RATE_LIMITED',
        'Demasiados intentos',
        `Espera ${seconds >= 60 ? `${Math.ceil(seconds / 60)} minutos` : `${seconds} segundos`} e intenta de nuevo.`,
      );
    }
  }

  private lastSweep = 0;
  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key);
  }
}
