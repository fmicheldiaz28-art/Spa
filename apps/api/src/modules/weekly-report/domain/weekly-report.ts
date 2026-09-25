/**
 * Reporte semanal para administración (Fase 2). Funciones puras: qué semana corresponde y cómo
 * se redacta el email a partir de las cifras.
 */
import { addDays, isoWeekday } from '../../availability/domain/time.js';

export interface WeeklyStats {
  week: { from: string; to: string };
  appointments: number;
  completed: number;
  noShow: number;
  cancelled: number;
  online: number;
  clientConfirmed: number;
  remindersSent: number;
  revenue: number;
  prevRevenue: number;
  newClients: number;
  topServices: { name: string; count: number }[];
  nextWeekAppointments: number;
  /** Último sello de la auditoría: ancla externa en la bandeja de administración (docs/11 §196). */
  auditSeal?: { seq: number; hash: string } | null;
}

/** Lunes de la semana anterior a `today` (fecha local YYYY-MM-DD). */
export function previousWeek(today: string): { from: string; to: string } {
  const thisMonday = addDays(today, 1 - isoWeekday(today));
  return { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) };
}

/** Se envía los lunes a partir de la hora configurada (hora local). */
export function isSendTime(today: string, localHour: number, sendHour: number): boolean {
  return isoWeekday(today) === 1 && localHour >= sendHour;
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const money = (n: number) => `Bs ${n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function shortDate(d: string) {
  const [, m, day] = d.split('-');
  return `${Number(day)}/${Number(m)}`;
}

export function renderWeeklyReport(s: WeeklyStats, orgName: string, appUrl: string): { subject: string; text: string; html: string } {
  const attended = s.completed + s.noShow;
  const noShowPct = pct(s.noShow, attended);
  const cancelPct = pct(s.cancelled, s.appointments);
  const delta = s.prevRevenue ? Math.round(((s.revenue - s.prevRevenue) / s.prevRevenue) * 1000) / 10 : null;
  const range = `${shortDate(s.week.from)} al ${shortDate(s.week.to)}`;

  const lines: [string, string][] = [
    ['Ingresos', `${money(s.revenue)}${delta === null ? '' : ` (${delta >= 0 ? '+' : ''}${delta}% vs. semana anterior)`}`],
    ['Citas', `${s.appointments} (${s.completed} atendidas, ${s.online} online)`],
    ['No-show', `${s.noShow} (${noShowPct}%)`],
    ['Cancelaciones', `${s.cancelled} (${cancelPct}%)`],
    ['Clientas nuevas', String(s.newClients)],
    ['Recordatorios enviados', `${s.remindersSent} · ${s.clientConfirmed} confirmaron asistencia`],
    ['Agendadas para esta semana', String(s.nextWeekAppointments)],
  ];
  const seal = s.auditSeal ? `Sello de auditoría #${s.auditSeal.seq} · ${s.auditSeal.hash.slice(0, 16)}` : null;
  const top = s.topServices.length ? s.topServices.map((t, i) => `${i + 1}. ${t.name} (${t.count})`) : ['Sin servicios atendidos'];
  const alert = noShowPct >= 12 ? 'El no-show superó el 12 %: revisa las clientas marcadas en la agenda y confirma por teléfono.' : null;

  const text = [
    `Resumen de ${orgName}, semana del ${range}`,
    '',
    ...lines.map(([k, v]) => `${k}: ${v}`),
    '',
    'Servicios más pedidos:',
    ...top,
    ...(alert ? ['', alert] : []),
    ...(seal ? ['', `${seal} (guarda este email: permite comprobar que el historial no fue alterado)`] : []),
    '',
    `Ver el dashboard: ${appUrl}/app/dashboard`,
  ].join('\n');

  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#1f2a24">
<h2 style="margin:0 0 4px">Resumen semanal</h2>
<p style="margin:0 0 16px;color:#5b665f">${esc(orgName)} · semana del ${range}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${lines.map(([k, v]) => `<tr><td style="padding:6px 0;color:#5b665f">${esc(k)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${esc(v)}</td></tr>`).join('\n')}
</table>
<p style="margin:16px 0 4px;font-weight:600">Servicios más pedidos</p>
<ol style="margin:0;padding-left:20px">${s.topServices.map((t) => `<li>${esc(t.name)} (${t.count})</li>`).join('') || '<li>Sin servicios atendidos</li>'}</ol>
${alert ? `<p style="margin:16px 0;padding:10px 12px;border-radius:8px;background:#fdecec;color:#a33">${esc(alert)}</p>` : ''}
${seal ? `<p style="margin:16px 0 0;color:#5b665f;font-size:12px">${esc(seal)} · guarda este email: permite comprobar que el historial no fue alterado.</p>` : ''}
<p style="margin-top:20px"><a href="${appUrl}/app/dashboard" style="color:#3f7d5c">Ver el dashboard</a></p>
</div>`;

  return { subject: `Resumen semanal ${range} · ${money(s.revenue)} · ${s.appointments} citas`, text, html };
}
