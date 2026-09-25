import { describe, expect, it } from 'vitest';
import { RENOTIFY_MS, shouldNotify, slotsInWindow, WINDOWS } from './waitlist.js';

const slots = [{ time: '09:00' }, { time: '12:45' }, { time: '13:00' }, { time: '17:30' }];

describe('slotsInWindow', () => {
  it('sin preferencia devuelve todo', () => {
    expect(slotsInWindow(slots, WINDOWS.ANY)).toHaveLength(4);
  });

  it('mañana y tarde se parten a las 13:00', () => {
    expect(slotsInWindow(slots, WINDOWS.MORNING).map((s) => s.time)).toEqual(['09:00', '12:45']);
    expect(slotsInWindow(slots, WINDOWS.AFTERNOON).map((s) => s.time)).toEqual(['13:00', '17:30']);
  });

  it('rango personalizado', () => {
    expect(slotsInWindow(slots, { from: 12 * 60, to: 17 * 60 }).map((s) => s.time)).toEqual(['12:45', '13:00']);
  });
});

describe('shouldNotify', () => {
  const now = new Date('2026-09-26T15:00:00Z');

  it('avisa a entradas abiertas sin aviso previo', () => {
    expect(shouldNotify({ status: 'ACTIVA', notifiedAt: null }, now)).toBe(true);
  });

  it('no repite antes de 3 horas', () => {
    expect(shouldNotify({ status: 'NOTIFICADA', notifiedAt: new Date(now.getTime() - RENOTIFY_MS + 60_000) }, now)).toBe(false);
    expect(shouldNotify({ status: 'NOTIFICADA', notifiedAt: new Date(now.getTime() - RENOTIFY_MS) }, now)).toBe(true);
  });

  it('nunca a entradas cerradas', () => {
    for (const status of ['CONVERTIDA', 'VENCIDA', 'CANCELADA']) expect(shouldNotify({ status, notifiedAt: null }, now)).toBe(false);
  });
});
