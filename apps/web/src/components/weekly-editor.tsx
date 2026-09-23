'use client';

import { Plus, X } from 'lucide-react';
import { type Block, WEEKDAYS } from '@/lib/schedule';

/** Editor visual del horario semanal: tramos por día (docs/09-ux-ui.md §15.10). */
export function WeeklyEditor({ value, onChange, disabled }: { value: Block[]; onChange: (blocks: Block[]) => void; disabled?: boolean }) {
  const setDay = (weekday: number, blocks: Block[]) =>
    onChange([...value.filter((b) => b.weekday !== weekday), ...blocks].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)));

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-surface">
      {WEEKDAYS.map(({ n, label }) => {
        const blocks = value.filter((b) => b.weekday === n);
        const works = blocks.length > 0;
        return (
          <div key={n} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <label className="flex w-36 shrink-0 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={works}
                disabled={disabled}
                onChange={(e) => setDay(n, e.target.checked ? [{ weekday: n, start: '09:00', end: '19:00' }] : [])}
                className="size-4 accent-[var(--color-primary)]"
              />
              {label}
            </label>
            {works ? (
              <div className="flex flex-wrap items-center gap-2">
                {blocks.map((b, i) => (
                  <span key={i} className="flex items-center gap-1 rounded-lg bg-bg px-2 py-1">
                    <input
                      type="time"
                      step={900}
                      value={b.start}
                      disabled={disabled}
                      onChange={(e) => setDay(n, blocks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                      className="rounded border border-border bg-surface px-1.5 py-1 text-sm"
                      aria-label={`${label} inicio tramo ${i + 1}`}
                    />
                    <span className="text-muted">–</span>
                    <input
                      type="time"
                      step={900}
                      value={b.end}
                      disabled={disabled}
                      onChange={(e) => setDay(n, blocks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                      className="rounded border border-border bg-surface px-1.5 py-1 text-sm"
                      aria-label={`${label} fin tramo ${i + 1}`}
                    />
                    {!disabled && (
                      <button type="button" onClick={() => setDay(n, blocks.filter((_, j) => j !== i))} className="p-1 text-muted hover:text-danger" aria-label="Quitar tramo">
                        <X className="size-3.5" />
                      </button>
                    )}
                  </span>
                ))}
                {!disabled && blocks.length < 3 && (
                  <button
                    type="button"
                    onClick={() => setDay(n, [...blocks, { weekday: n, start: blocks.at(-1)?.end ?? '14:00', end: '19:00' }])}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Plus className="size-3" /> tramo
                  </button>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted">No trabaja</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
