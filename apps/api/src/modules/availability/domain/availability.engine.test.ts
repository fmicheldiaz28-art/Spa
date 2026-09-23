import { describe, expect, it } from 'vitest';
import { computeSlots, type DayInput, isStaffAvailable, pickLeastBusy, type StaffDay } from './availability.engine.js';
import { addDays, intersect, isoWeekday, localDate, localToUtc, normalize, subtract, utcToLocalMinutes } from './time.js';

const h = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const iv = (a: string, b: string) => ({ start: h(a), end: h(b) });
const starts = (slots: { start: number }[]) =>
  slots.map((s) => `${String(Math.floor(s.start / 60)).padStart(2, '0')}:${String(s.start % 60).padStart(2, '0')}`);

const andrea = (over: Partial<StaffDay> = {}): StaffDay => ({
  staffId: 'andrea',
  shifts: [iv('09:00', '13:00'), iv('14:00', '19:00')],
  absences: [],
  busy: [],
  ...over,
});

const base = (over: Partial<DayInput> = {}): DayInput => ({
  businessHours: [iv('09:00', '19:00')],
  holiday: null,
  staff: [andrea()],
  durationMin: 60,
  bufferAfterMin: 10,
  slotIntervalMin: 15,
  ...over,
});

describe('álgebra de intervalos', () => {
  it('fusiona intervalos solapados o contiguos', () => {
    expect(normalize([iv('10:00', '11:00'), iv('09:00', '10:00'), iv('10:30', '12:00')])).toEqual([iv('09:00', '12:00')]);
  });
  it('intersecta y resta', () => {
    expect(intersect([iv('09:00', '19:00')], [iv('08:00', '10:00'), iv('18:00', '20:00')])).toEqual([iv('09:00', '10:00'), iv('18:00', '19:00')]);
    expect(subtract([iv('09:00', '13:00')], [iv('10:00', '11:00')])).toEqual([iv('09:00', '10:00'), iv('11:00', '13:00')]);
  });
});

describe('zona horaria America/La_Paz (UTC−4, sin horario de verano)', () => {
  const tz = 'America/La_Paz';
  it('convierte hora local a UTC y viceversa', () => {
    expect(localToUtc('2026-10-14', h('15:00'), tz).toISOString()).toBe('2026-10-14T19:00:00.000Z');
    expect(utcToLocalMinutes(new Date('2026-10-14T19:00:00Z'), '2026-10-14', tz)).toBe(h('15:00'));
    expect(localDate(new Date('2026-10-15T02:30:00Z'), tz)).toBe('2026-10-14');
  });
  it('maneja zonas con horario de verano', () => {
    // Nueva York cambia a horario de verano el 8/3/2026: 10:00 local = 14:00 UTC.
    expect(localToUtc('2026-03-09', h('10:00'), 'America/New_York').toISOString()).toBe('2026-03-09T14:00:00.000Z');
    expect(localToUtc('2026-03-06', h('10:00'), 'America/New_York').toISOString()).toBe('2026-03-06T15:00:00.000Z');
  });
  it('calcula día de la semana y suma días', () => {
    expect(isoWeekday('2026-10-13')).toBe(2); // martes
    expect(isoWeekday('2026-10-18')).toBe(7); // domingo
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('computeSlots', () => {
  it('genera slots cada 15 min respetando el almuerzo', () => {
    const s = starts(computeSlots(base()));
    expect(s[0]).toBe('09:00');
    expect(s).toContain('12:00'); // 12:00–13:00 cabe justo antes del almuerzo
    expect(s).not.toContain('12:15'); // terminaría 13:15, en almuerzo
    expect(s).toContain('14:00');
    expect(s.at(-1)).toBe('18:00'); // último que termina a las 19:00
  });

  it('permite que la preparación final exceda el cierre, pero no el servicio', () => {
    expect(starts(computeSlots(base()))).toContain('18:00'); // 18:00–19:00 + 10 min de preparación
  });

  it('no ofrece horarios que pisan una cita (incluida su preparación)', () => {
    // Cita 15:00–16:00 con preparación hasta 16:10
    const s = starts(computeSlots(base({ staff: [andrea({ busy: [iv('15:00', '16:10')] })] })));
    expect(s).not.toContain('14:00'); // 14:00–15:00 + 10 min pisa la cita de las 15:00
    expect(s).not.toContain('15:30');
    expect(s).not.toContain('16:00');
    expect(s).toContain('16:15'); // primer inicio alineado después de 16:10
  });

  it('respeta vacaciones, permisos y bloqueos', () => {
    const s = starts(computeSlots(base({ staff: [andrea({ absences: [iv('09:00', '11:00')] })] })));
    expect(s[0]).toBe('11:00');
    expect(starts(computeSlots(base({ staff: [andrea({ absences: [iv('00:00', '24:00')] })] })))).toEqual([]);
  });

  it('no ofrece nada en un feriado cerrado, salvo disponibilidad EXTRA', () => {
    expect(computeSlots(base({ holiday: { closed: true } }))).toEqual([]);
    const extra = computeSlots(base({ holiday: { closed: true }, staff: [andrea({ extra: [iv('10:00', '12:00')] })] }));
    expect(starts(extra)).toEqual(['10:00', '10:15', '10:30', '10:45', '11:00']);
  });

  it('aplica la apertura parcial de un feriado', () => {
    const s = starts(computeSlots(base({ holiday: { closed: false, open: [iv('09:00', '12:00')] } })));
    expect(s.at(-1)).toBe('11:00');
  });

  it('respeta el horario del negocio aunque la colaboradora tenga un turno más largo', () => {
    const s = starts(computeSlots(base({ businessHours: [iv('10:00', '18:00')] })));
    expect(s[0]).toBe('10:00');
    expect(s.at(-1)).toBe('17:00');
  });

  it('no ofrece horarios anteriores a la anticipación mínima', () => {
    const s = starts(computeSlots(base({ earliestStart: h('15:07') })));
    expect(s[0]).toBe('15:15');
  });

  it('no ofrece servicios más largos que el turno', () => {
    expect(computeSlots(base({ durationMin: 360 }))).toEqual([]); // el tramo más largo es de 5 h
    expect(starts(computeSlots(base({ durationMin: 300 })))).toEqual(['14:00']); // cabe justo
  });

  it('une la disponibilidad de varias colaboradoras', () => {
    const lucia: StaffDay = { staffId: 'lucia', shifts: [iv('14:00', '19:00')], absences: [], busy: [] };
    const slots = computeSlots(base({ staff: [andrea({ busy: [iv('09:00', '10:10')] }), lucia] }));
    const at = (t: string) => slots.find((s) => s.start === h(t))?.staffIds.sort();
    expect(at('09:00')).toBeUndefined();
    expect(at('10:15')).toEqual(['andrea']);
    expect(at('15:00')).toEqual(['andrea', 'lucia']);
  });

  it('isStaffAvailable coincide con los slots generados', () => {
    const input = base({ staff: [andrea({ busy: [iv('15:00', '16:10')] })] });
    const staff = input.staff[0]!;
    for (let start = h('08:00'); start < h('20:00'); start += 15) {
      const offered = computeSlots(input).some((s) => s.start === start);
      expect(isStaffAvailable(input, staff, start)).toBe(offered);
    }
  });
});

describe('pickLeastBusy', () => {
  it('elige a la colaboradora con menos carga ese día', () => {
    const staff: StaffDay[] = [andrea({ busy: [iv('09:00', '12:00')] }), { staffId: 'lucia', shifts: [], absences: [], busy: [iv('09:00', '10:00')] }];
    expect(pickLeastBusy(['andrea', 'lucia'], staff)).toBe('lucia');
  });
  it('desempata de forma estable', () => {
    expect(pickLeastBusy(['lucia', 'andrea'], [andrea(), { staffId: 'lucia', shifts: [], absences: [], busy: [] }])).toBe('andrea');
  });
});
