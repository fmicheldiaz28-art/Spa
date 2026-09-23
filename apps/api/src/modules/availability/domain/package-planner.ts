import { type DayInput, isStaffAvailable, type StaffDay } from './availability.engine.js';
import type { Interval } from './time.js';

/**
 * Planificador de paquetes (docs/03-arquitectura-stack.md §7.7): los ítems se agrupan por
 * `parallelGroup`; los de un mismo grupo empiezan juntos con colaboradoras distintas y cada grupo
 * empieza cuando termina el anterior. Búsqueda con retroceso (con ≤ 5 especialistas es trivial).
 */
export interface PlanItem {
  serviceId: string;
  sequence: number;
  parallelGroup: number;
  durationMin: number;
  bufferAfterMin: number;
  /** Colaboradoras habilitadas para ese servicio. */
  candidates: string[];
}

export interface PlannedItem {
  serviceId: string;
  staffId: string;
  start: number;
  end: number;
}

type DayBase = Pick<DayInput, 'businessHours' | 'holiday'>;

export function planPackage(day: DayBase, staff: Map<string, StaffDay>, items: PlanItem[], start: number): PlannedItem[] | null {
  const groups = [...new Set(items.map((i) => i.parallelGroup))].sort((a, b) => a - b).map((g) => items.filter((i) => i.parallelGroup === g).sort((a, b) => a.sequence - b.sequence));
  const planned: PlannedItem[] = [];
  // Ocupación adicional que va generando el propio plan (incluye preparación).
  const extraBusy = new Map<string, Interval[]>();

  const fits = (item: PlanItem, staffId: string, at: number) => {
    const s = staff.get(staffId);
    if (!s) return false;
    const input: DayInput = { ...day, staff: [], durationMin: item.durationMin, bufferAfterMin: item.bufferAfterMin, slotIntervalMin: 5 };
    return isStaffAvailable(input, { ...s, busy: [...s.busy, ...(extraBusy.get(staffId) ?? [])] }, at);
  };

  const place = (groupIndex: number, at: number): boolean => {
    if (groupIndex === groups.length) return true;
    const group = groups[groupIndex]!;
    const used = new Set<string>();
    const chosen: PlannedItem[] = [];

    const assign = (i: number): boolean => {
      if (i === group.length) {
        const next = Math.max(...chosen.map((c) => c.end));
        return place(groupIndex + 1, next);
      }
      const item = group[i]!;
      for (const staffId of item.candidates) {
        if (used.has(staffId) || !fits(item, staffId, at)) continue;
        const p = { serviceId: item.serviceId, staffId, start: at, end: at + item.durationMin };
        used.add(staffId);
        chosen.push(p);
        planned.push(p);
        const busy = extraBusy.get(staffId) ?? [];
        busy.push({ start: at, end: p.end + item.bufferAfterMin });
        extraBusy.set(staffId, busy);
        if (assign(i + 1)) return true;
        busy.pop();
        planned.pop();
        chosen.pop();
        used.delete(staffId);
      }
      return false;
    };
    return assign(0);
  };

  return place(0, start) ? [...planned] : null;
}
