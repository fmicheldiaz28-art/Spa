'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

const WEEK = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Calendario mensual con los días sin disponibilidad deshabilitados (docs/09-ux-ui.md §15.9, paso 3). */
export function MonthCalendar({
  month,
  available,
  selected,
  onSelect,
  onMonth,
  minMonth,
  maxMonth,
}: {
  month: string; // YYYY-MM
  available: Set<string> | null;
  selected: string | null;
  onSelect: (date: string) => void;
  onMonth: (month: string) => void;
  minMonth: string;
  maxMonth: string;
}) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7; // lunes = 0
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return d.toISOString().slice(0, 7);
  };
  const label = first.toLocaleDateString('es-BO', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" onClick={() => onMonth(shift(-1))} disabled={month <= minMonth} className="rounded-lg p-2 disabled:opacity-30" aria-label="Mes anterior">
          <ChevronLeft className="size-5" />
        </button>
        <p className="font-medium capitalize">{label}</p>
        <button type="button" onClick={() => onMonth(shift(1))} disabled={month >= maxMonth} className="rounded-lg p-2 disabled:opacity-30" aria-label="Mes siguiente">
          <ChevronRight className="size-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
        {WEEK.map((d, i) => (
          <span key={i} className="py-1">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: offset }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`;
          const enabled = available?.has(date) ?? false;
          const isSelected = selected === date;
          return (
            <button
              key={date}
              type="button"
              disabled={!enabled}
              onClick={() => onSelect(date)}
              className={`aspect-square rounded-full text-sm tabular-nums transition ${
                isSelected ? 'bg-primary font-semibold text-white' : enabled ? 'font-medium text-text hover:bg-primary/10' : 'text-muted/40'
              }`}
              aria-pressed={isSelected}
              aria-label={`${i + 1}${enabled ? '' : ' (sin horarios)'}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      {available === null && <p className="mt-2 text-center text-xs text-muted">Buscando días disponibles…</p>}
    </div>
  );
}
