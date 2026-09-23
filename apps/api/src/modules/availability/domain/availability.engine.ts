import { contains, type Interval, intersect, overlaps, subtract } from './time.js';

/**
 * Motor de disponibilidad (docs/03-arquitectura-stack.md §7.7). Función PURA: recibe todo lo que
 * necesita para un día y una sede, en minutos locales, y devuelve los horarios libres.
 *
 *   trabajable(colaboradora) = horario_negocio ∩ horario_laboral ∩ apertura_feriado
 *   bloqueado(colaboradora)  = ausencias ∪ citas_activas ∪ holds
 *   slot válido  ⇔  [inicio, inicio + duración] ⊆ trabajable
 *                 ∧ [inicio, inicio + duración + preparación) ∩ bloqueado = ∅
 *
 * El tiempo de preparación posterior puede exceder el cierre (no hay otra cita después), pero no
 * puede pisar una ausencia ni otra cita.
 */

export interface StaffDay {
  staffId: string;
  /** Tramos del horario laboral de ese día. */
  shifts: Interval[];
  /** Vacaciones, permisos y bloqueos aprobados (ya recortados al día). */
  absences: Interval[];
  /** Citas activas: [inicio, fin + preparación). */
  busy: Interval[];
  /** Tramos EXTRA: disponibilidad adicional aunque esté fuera del horario del negocio. */
  extra?: Interval[];
}

export interface DayInput {
  businessHours: Interval[];
  /** null = día normal; { closed: true } = cerrado; tramos = apertura parcial. */
  holiday: null | { closed: true } | { closed: false; open: Interval[] };
  staff: StaffDay[];
  durationMin: number;
  bufferAfterMin: number;
  slotIntervalMin: number;
  /** Primer minuto reservable (hora actual + anticipación mínima si la fecha es hoy). */
  earliestStart?: number;
}

export interface Slot {
  start: number;
  end: number;
  staffIds: string[];
}

export function workableIntervals(input: Pick<DayInput, 'businessHours' | 'holiday'>, staff: StaffDay): Interval[] {
  if (input.holiday?.closed) return staff.extra ?? [];
  const opening = input.holiday ? intersect(input.businessHours, input.holiday.open) : input.businessHours;
  return [...intersect(opening, staff.shifts), ...(staff.extra ?? [])];
}

export function isStaffAvailable(input: DayInput, staff: StaffDay, start: number): boolean {
  const service = { start, end: start + input.durationMin };
  const blocked = { start, end: service.end + input.bufferAfterMin };
  return (
    contains(workableIntervals(input, staff), service) &&
    !overlaps(blocked, staff.absences) &&
    !overlaps(blocked, staff.busy)
  );
}

export function computeSlots(input: DayInput): Slot[] {
  if (input.durationMin <= 0 || input.slotIntervalMin <= 0) return [];
  const step = input.slotIntervalMin;
  const byStart = new Map<number, string[]>();

  for (const staff of input.staff) {
    const free = subtract(workableIntervals(input, staff), staff.absences);
    for (const window of free) {
      // Alinea al múltiplo del intervalo (09:00, 09:15, …) dentro de la ventana libre.
      let start = Math.ceil(Math.max(window.start, input.earliestStart ?? -Infinity) / step) * step;
      for (; start + input.durationMin <= window.end; start += step) {
        if (isStaffAvailable(input, staff, start)) {
          const list = byStart.get(start) ?? [];
          list.push(staff.staffId);
          byStart.set(start, list);
        }
      }
    }
  }

  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, staffIds]) => ({ start, end: start + input.durationMin, staffIds: [...new Set(staffIds)] }));
}

/**
 * "Cualquiera disponible": asigna la colaboradora con menos minutos ocupados ese día (reparto
 * justo), con desempate estable por id (docs/03 §7.7).
 */
export function pickLeastBusy(candidates: string[], staff: StaffDay[]): string | null {
  const load = new Map(staff.map((s) => [s.staffId, s.busy.reduce((sum, b) => sum + (b.end - b.start), 0)]));
  return [...candidates].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b))[0] ?? null;
}
