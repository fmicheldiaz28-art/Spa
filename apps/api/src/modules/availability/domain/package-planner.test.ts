import { describe, expect, it } from 'vitest';
import type { StaffDay } from './availability.engine.js';
import { type PlanItem, planPackage } from './package-planner.js';

const h = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const staff = (id: string, over: Partial<StaffDay> = {}): StaffDay => ({ staffId: id, shifts: [{ start: h('09:00'), end: h('19:00') }], absences: [], busy: [], ...over });
const day = { businessHours: [{ start: h('09:00'), end: h('19:00') }], holiday: null };

// Día de Novia: facial (Katherine) → masaje (Andrea/Lucía) → mani + pedi en paralelo (Uñas 1/Uñas 2)
const novia: PlanItem[] = [
  { serviceId: 'facial', sequence: 1, parallelGroup: 1, durationMin: 75, bufferAfterMin: 10, candidates: ['katherine'] },
  { serviceId: 'masaje', sequence: 2, parallelGroup: 2, durationMin: 60, bufferAfterMin: 10, candidates: ['andrea', 'lucia'] },
  { serviceId: 'mani', sequence: 3, parallelGroup: 3, durationMin: 45, bufferAfterMin: 10, candidates: ['unas1', 'unas2'] },
  { serviceId: 'pedi', sequence: 4, parallelGroup: 3, durationMin: 60, bufferAfterMin: 10, candidates: ['unas1', 'unas2'] },
];
const team = () => new Map(['katherine', 'andrea', 'lucia', 'unas1', 'unas2'].map((id) => [id, staff(id)]));

describe('planPackage', () => {
  it('encadena los grupos y paraleliza mani + pedi con colaboradoras distintas', () => {
    const plan = planPackage(day, team(), novia, h('09:00'))!;
    expect(plan.map((p) => [p.serviceId, p.start])).toEqual([
      ['facial', h('09:00')],
      ['masaje', h('10:15')],
      ['mani', h('11:15')],
      ['pedi', h('11:15')],
    ]);
    const mani = plan.find((p) => p.serviceId === 'mani')!;
    const pedi = plan.find((p) => p.serviceId === 'pedi')!;
    expect(mani.staffId).not.toBe(pedi.staffId);
  });

  it('usa a la otra masajista si la primera está ocupada', () => {
    const t = team();
    t.set('andrea', staff('andrea', { busy: [{ start: h('10:00'), end: h('12:00') }] }));
    const plan = planPackage(day, t, novia, h('09:00'))!;
    expect(plan.find((p) => p.serviceId === 'masaje')!.staffId).toBe('lucia');
  });

  it('falla si falta una colaboradora para el tramo paralelo', () => {
    const t = team();
    t.set('unas2', staff('unas2', { absences: [{ start: 0, end: 1440 }] }));
    expect(planPackage(day, t, novia, h('09:00'))).toBeNull();
  });

  it('no reutiliza a la misma colaboradora en tramos seguidos sin respetar su preparación', () => {
    const items: PlanItem[] = [
      { serviceId: 'a', sequence: 1, parallelGroup: 1, durationMin: 60, bufferAfterMin: 15, candidates: ['solo'] },
      { serviceId: 'b', sequence: 2, parallelGroup: 2, durationMin: 60, bufferAfterMin: 0, candidates: ['solo'] },
    ];
    // El tramo 2 empieza al terminar el 1 (10:00), pero "solo" tiene preparación hasta 10:15.
    expect(planPackage(day, new Map([['solo', staff('solo')]]), items, h('09:00'))).toBeNull();
  });

  it('no planifica fuera del horario', () => {
    expect(planPackage(day, team(), novia, h('17:00'))).toBeNull();
  });
});
