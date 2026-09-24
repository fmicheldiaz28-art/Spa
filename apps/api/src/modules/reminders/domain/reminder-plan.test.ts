import { describe, expect, it } from 'vitest';
import { dueReminder, reminderSlots } from './reminder-plan.js';

const H = 3_600_000;
const start = new Date('2026-09-25T19:00:00Z');
const at = (hoursBefore: number) => new Date(start.getTime() - hoursBefore * H);
const slots = reminderSlots([2, 24]);
const early = { startAt: start, createdAt: at(72) };

describe('reminderSlots', () => {
  it('ordena de mayor a menor, sin ceros ni repetidos', () => {
    expect(reminderSlots([2, 0, 24, 2]).map((s) => s.code)).toEqual(['REMINDER_24H', 'REMINDER_2H']);
  });
});

describe('dueReminder', () => {
  it('nada antes de T-24 h', () => {
    expect(dueReminder(early, at(30), slots)).toBeNull();
  });

  it('24 h entre T-24 h y T-2 h', () => {
    expect(dueReminder(early, at(24), slots)?.code).toBe('REMINDER_24H');
    expect(dueReminder(early, at(3), slots)?.code).toBe('REMINDER_24H');
  });

  it('2 h entre T-2 h y T-15 min', () => {
    expect(dueReminder(early, at(2), slots)?.code).toBe('REMINDER_2H');
    expect(dueReminder(early, at(0.3), slots)?.code).toBe('REMINDER_2H');
    expect(dueReminder(early, at(0.2), slots)).toBeNull();
  });

  it('omite el aviso si la cita se reservó después de su momento', () => {
    const late = { startAt: start, createdAt: at(5) };
    expect(dueReminder(late, at(4), slots)).toBeNull();
    expect(dueReminder(late, at(1), slots)?.code).toBe('REMINDER_2H');
  });

  it('con un solo aviso configurado', () => {
    expect(dueReminder(early, at(1), reminderSlots([24]))?.code).toBe('REMINDER_24H');
  });
});
