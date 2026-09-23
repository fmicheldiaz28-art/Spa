import { describe, expect, it } from 'vitest';
import { availableActions, canMarkNoShow, canRevert, isReschedulable, nextStatus } from './appointment-state.js';

describe('máquina de estados de la cita', () => {
  it('sigue el ciclo normal', () => {
    expect(nextStatus('PENDIENTE', 'confirm')).toBe('CONFIRMADA');
    expect(nextStatus('CONFIRMADA', 'check-in')).toBe('EN_CURSO');
    expect(nextStatus('EN_CURSO', 'complete')).toBe('COMPLETADA');
  });

  it('permite completar directamente una cita confirmada (sin check-in)', () => {
    expect(nextStatus('CONFIRMADA', 'complete')).toBe('COMPLETADA');
  });

  it('rechaza transiciones inválidas', () => {
    expect(nextStatus('COMPLETADA', 'cancel')).toBeNull();
    expect(nextStatus('CANCELADA', 'check-in')).toBeNull();
    expect(nextStatus('EN_CURSO', 'no-show')).toBeNull();
    expect(nextStatus('NO_SHOW', 'complete')).toBeNull();
    expect(nextStatus('CONFIRMADA', 'confirm')).toBeNull();
  });

  it('los estados finales no tienen acciones', () => {
    for (const s of ['COMPLETADA', 'CANCELADA', 'NO_SHOW'] as const) expect(availableActions(s)).toEqual([]);
  });

  it('solo se reagendan citas que ocupan la agenda', () => {
    expect(isReschedulable('CONFIRMADA')).toBe(true);
    expect(isReschedulable('PENDIENTE')).toBe(true);
    expect(isReschedulable('EN_CURSO')).toBe(false);
    expect(isReschedulable('CANCELADA')).toBe(false);
  });

  it('permite corregir estados finales solo hacia atrás', () => {
    expect(canRevert('NO_SHOW', 'CONFIRMADA')).toBe(true);
    expect(canRevert('COMPLETADA', 'EN_CURSO')).toBe(true);
    expect(canRevert('CANCELADA', 'CONFIRMADA')).toBe(true);
    expect(canRevert('CONFIRMADA', 'COMPLETADA')).toBe(false);
    expect(canRevert('NO_SHOW', 'COMPLETADA')).toBe(false);
  });

  it('el no-show exige esperar la tolerancia', () => {
    const start = new Date('2026-10-14T19:00:00Z');
    expect(canMarkNoShow(start, new Date('2026-10-14T19:10:00Z'), 15)).toBe(false);
    expect(canMarkNoShow(start, new Date('2026-10-14T19:15:00Z'), 15)).toBe(true);
  });
});
