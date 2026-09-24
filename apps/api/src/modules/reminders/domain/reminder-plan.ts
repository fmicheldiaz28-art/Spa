/**
 * Qué recordatorio corresponde a una cita en este momento (CU-21). Función pura.
 *
 * Con avisos a 24 h y 2 h: entre T-24 h y T-2 h toca el de 24 h; entre T-2 h y T-15 min, el de
 * 2 h. Si la cita se reservó después del momento de un aviso (p. ej. 5 h antes), ese aviso se
 * omite: la clienta acaba de recibir la confirmación.
 */
export const REMINDER_CUTOFF_MIN = 15;

export interface ReminderSlot {
  code: string;
  hoursBefore: number;
}

export function reminderSlots(hours: number[]): ReminderSlot[] {
  return [...new Set(hours.filter((h) => h > 0))].sort((a, b) => b - a).map((h) => ({ code: `REMINDER_${h}H`, hoursBefore: h }));
}

export function dueReminder(a: { startAt: Date; createdAt: Date }, now: Date, slots: ReminderSlot[]): ReminderSlot | null {
  const H = 3_600_000;
  const start = a.startAt.getTime();
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const opensAt = start - slot.hoursBefore * H;
    const closesAt = i + 1 < slots.length ? start - slots[i + 1]!.hoursBefore * H : start - REMINDER_CUTOFF_MIN * 60_000;
    if (now.getTime() >= opensAt && now.getTime() < closesAt) {
      return a.createdAt.getTime() <= opensAt ? slot : null;
    }
  }
  return null;
}
