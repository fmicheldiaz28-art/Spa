import { describe, expect, it } from 'vitest';
import { isSendTime, previousWeek, renderWeeklyReport, type WeeklyStats } from './weekly-report.js';

const stats: WeeklyStats = {
  week: { from: '2026-09-14', to: '2026-09-20' },
  appointments: 40,
  completed: 30,
  noShow: 5,
  cancelled: 5,
  online: 12,
  clientConfirmed: 18,
  remindersSent: 25,
  revenue: 6000,
  prevRevenue: 5000,
  newClients: 4,
  topServices: [{ name: 'Masaje relajante', count: 12 }],
  nextWeekAppointments: 22,
};

describe('previousWeek', () => {
  it('lunes a domingo de la semana anterior', () => {
    expect(previousWeek('2026-09-21')).toEqual({ from: '2026-09-14', to: '2026-09-20' });
    expect(previousWeek('2026-09-27')).toEqual({ from: '2026-09-14', to: '2026-09-20' });
  });
});

describe('isSendTime', () => {
  it('solo los lunes desde la hora configurada', () => {
    expect(isSendTime('2026-09-21', 8, 8)).toBe(true);
    expect(isSendTime('2026-09-21', 7, 8)).toBe(false);
    expect(isSendTime('2026-09-22', 9, 8)).toBe(false);
  });
});

describe('renderWeeklyReport', () => {
  const r = renderWeeklyReport(stats, 'NaturalSpa', 'https://app.test');

  it('calcula no-show sobre citas que debían ocurrir y la variación de ingresos', () => {
    expect(r.text).toContain('No-show: 5 (14.3%)');
    expect(r.text).toContain('+20% vs. semana anterior');
    expect(r.subject).toContain('40 citas');
  });

  it('alerta cuando el no-show supera la meta', () => {
    expect(r.text).toContain('superó el 12 %');
    expect(renderWeeklyReport({ ...stats, noShow: 1 }, 'X', 'u').text).not.toContain('superó');
  });

  it('escapa HTML en nombres', () => {
    const h = renderWeeklyReport({ ...stats, topServices: [{ name: '<b>x</b>', count: 1 }] }, 'A&B', 'u').html;
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(h).toContain('A&amp;B');
  });
});
