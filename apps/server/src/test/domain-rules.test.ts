import { describe, expect, it } from 'vitest';
import { allowedTransitions, assertTransition } from '../modules/tasks/lifecycle';
import { policy, type TaskFacts } from '../modules/identity/policy';
import type { Principal } from '../modules/identity/principal';
import { afterCompletion, scheduledAfter, scheduledOnOrAfter, type RecurrenceRule } from '../modules/recurrence/rules';
import { planDateReminders } from '../modules/notifications/plan';
import { endOfWeek } from '../lib/dates';

describe('task lifecycle', () => {
  it('allows the forward path and reopen', () => {
    expect(() => assertTransition('new', 'in_progress', false)).not.toThrow();
    expect(() => assertTransition('in_progress', 'waiting', false)).not.toThrow();
    expect(() => assertTransition('waiting', 'completed', false)).not.toThrow();
    expect(() => assertTransition('completed', 'in_progress', false)).not.toThrow();
    expect(() => assertTransition('cancelled', 'new', false)).not.toThrow();
  });
  it('rejects invalid transitions', () => {
    expect(() => assertTransition('completed', 'waiting', false)).toThrow(/Cannot move/);
    expect(() => assertTransition('cancelled', 'completed', false)).toThrow(/Cannot move/);
    expect(() => assertTransition('new', 'new', false)).toThrow(/Cannot move/);
  });
  it('freezes archived tasks', () => {
    expect(() => assertTransition('new', 'in_progress', true)).toThrow(/Archived/);
    expect(allowedTransitions('new', true)).toEqual([]);
  });
});

describe('authorization policy', () => {
  const task: TaskFacts = { id: 't1', orgId: 'o1', ownerPersonId: 'owner', participantIds: ['part'] };
  const p = (personId: string, access: Principal['access'], scopeTaskId: string | null = null, orgId = 'o1'): Principal => ({
    personId,
    orgId,
    access,
    scopeTaskId,
    via: 'session',
  });

  it('managers see and edit everything in their organisation only', () => {
    expect(policy.canViewTask(p('m', 'manager'), task)).toBe(true);
    expect(policy.canEditTask(p('m', 'manager'), task)).toBe(true);
    expect(policy.canViewTask(p('m', 'manager', null, 'other'), task)).toBe(false);
  });
  it('guests see and update status only for tasks they are involved in', () => {
    expect(policy.canViewTask(p('part', 'guest'), task)).toBe(true);
    expect(policy.canChangeStatus(p('part', 'guest'), task)).toBe(true);
    expect(policy.canEditTask(p('part', 'guest'), task)).toBe(false);
    expect(policy.canViewTask(p('stranger', 'guest'), task)).toBe(false);
    expect(policy.canCreateTask(p('part', 'guest'))).toBe(false);
  });
  it('magic-link sessions are confined to one task', () => {
    expect(policy.canViewTask(p('owner', 'link', 't1'), task)).toBe(true);
    expect(policy.canViewTask(p('owner', 'link', 't2'), task)).toBe(false);
    expect(policy.canListTasks(p('owner', 'link', 't1'))).toBe(false);
  });
});

describe('recurrence rules', () => {
  const rule = (r: Partial<RecurrenceRule>): RecurrenceRule => ({
    freq: 'daily',
    interval: 1,
    byWeekday: [],
    byMonthDay: null,
    startDate: '2026-10-04',
    endDate: null,
    ...r,
  });

  it('daily with interval', () => {
    const r = rule({ interval: 3 });
    expect(scheduledOnOrAfter(r, '2026-10-01')).toBe('2026-10-04');
    expect(scheduledOnOrAfter(r, '2026-10-05')).toBe('2026-10-07');
    expect(scheduledAfter(r, '2026-10-07')).toBe('2026-10-10');
  });
  it('weekly on selected weekdays (Sunday-based weeks)', () => {
    const r = rule({ freq: 'weekly', byWeekday: [0, 3] }); // Sunday, Wednesday
    expect(scheduledOnOrAfter(r, '2026-10-04')).toBe('2026-10-04');
    expect(scheduledAfter(r, '2026-10-04')).toBe('2026-10-07');
    expect(scheduledAfter(r, '2026-10-07')).toBe('2026-10-11');
  });
  it('bi-weekly skips alternate weeks', () => {
    const r = rule({ freq: 'weekly', interval: 2, byWeekday: [1] }); // Monday
    expect(scheduledOnOrAfter(r, '2026-10-04')).toBe('2026-10-05');
    expect(scheduledAfter(r, '2026-10-05')).toBe('2026-10-19');
  });
  it('monthly clamps to the last day of short months', () => {
    const r = rule({ freq: 'monthly', byMonthDay: 31, startDate: '2026-01-31' });
    expect(scheduledAfter(r, '2026-01-31')).toBe('2026-02-28');
    expect(scheduledAfter(r, '2026-02-28')).toBe('2026-03-31');
  });
  it('respects the end date', () => {
    const r = rule({ endDate: '2026-10-05' });
    expect(scheduledAfter(r, '2026-10-05')).toBeNull();
  });
  it('after-completion counts from the completion day', () => {
    expect(afterCompletion(rule({ freq: 'weekly' }), '2026-10-09')).toBe('2026-10-16');
    expect(afterCompletion(rule({ freq: 'monthly' }), '2026-01-31')).toBe('2026-02-28');
    expect(afterCompletion(rule({ endDate: '2026-10-09' }), '2026-10-09')).toBeNull();
  });
});

describe('reminder planning', () => {
  const settings = { timezone: 'Asia/Jerusalem', reminderHour: 9, dueSoonDays: 1 };
  it('plans due-soon, due-today and overdue at 09:00 local time for every recipient once', () => {
    const plan = planDateReminders('2026-10-10', ['a', 'b', 'a'], settings, new Date('2026-10-01T00:00:00Z'));
    expect(plan).toHaveLength(6);
    const forA = plan.filter((r) => r.personId === 'a').map((r) => [r.kind, r.sendAt.toISOString()]);
    expect(forA).toEqual([
      ['due_soon', '2026-10-09T06:00:00.000Z'],
      ['due_today', '2026-10-10T06:00:00.000Z'],
      ['overdue', '2026-10-11T06:00:00.000Z'],
    ]);
  });
  it('handles the switch to winter time', () => {
    const [r] = planDateReminders('2026-10-26', ['a'], { ...settings, dueSoonDays: 0 }, new Date('2026-10-01T00:00:00Z'));
    expect(r!.sendAt.toISOString()).toBe('2026-10-26T07:00:00.000Z'); // UTC+2 after 25 Oct
  });
  it('skips reminders whose time has passed and undated tasks', () => {
    expect(planDateReminders('2026-10-10', ['a'], settings, new Date('2026-10-10T12:00:00Z')).map((r) => r.kind)).toEqual(['overdue']);
    expect(planDateReminders(null, ['a'], settings, new Date())).toEqual([]);
  });
  it('weeks end on Saturday', () => {
    expect(endOfWeek('2026-10-04')).toBe('2026-10-10');
    expect(endOfWeek('2026-10-10')).toBe('2026-10-10');
  });
});
