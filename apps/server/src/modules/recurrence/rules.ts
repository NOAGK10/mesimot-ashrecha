import { DateTime } from 'luxon';
import type { IsoDate } from '../../lib/dates';

export interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  /** 0 = Sunday … 6 = Saturday. Empty → weekday of startDate. */
  byWeekday: readonly number[];
  /** Null → day-of-month of startDate. Clamped to the month's last day. */
  byMonthDay: number | null;
  startDate: IsoDate;
  endDate: IsoDate | null;
}

const d = (s: IsoDate) => DateTime.fromISO(s, { zone: 'utc' });
const iso = (dt: DateTime) => dt.toISODate()!;
const sun0 = (dt: DateTime) => dt.weekday % 7; // luxon: Mon=1 … Sun=7
const MAX_STEPS = 5000;

/** Fixed-schedule mode: the first occurrence date on or after `from`, or null if the series has ended. */
export function scheduledOnOrAfter(rule: RecurrenceRule, from: IsoDate): IsoDate | null {
  const start = d(rule.startDate);
  let cursor = d(from) < start ? start : d(from);
  const end = rule.endDate ? d(rule.endDate) : null;
  const within = (x: DateTime) => (end === null || x <= end ? iso(x) : null);

  switch (rule.freq) {
    case 'daily': {
      const diff = cursor.diff(start, 'days').days;
      const k = Math.ceil(diff / rule.interval);
      return within(start.plus({ days: k * rule.interval }));
    }
    case 'weekly': {
      const days = rule.byWeekday.length ? new Set(rule.byWeekday) : new Set([sun0(start)]);
      const week0 = start.minus({ days: sun0(start) });
      for (let i = 0; i < MAX_STEPS; i++) {
        if (end && cursor > end) return null;
        const weekIndex = Math.floor(cursor.diff(week0, 'days').days / 7);
        if (weekIndex % rule.interval === 0 && days.has(sun0(cursor))) return within(cursor);
        cursor = cursor.plus({ days: 1 });
      }
      return null;
    }
    case 'monthly': {
      const day = rule.byMonthDay ?? start.day;
      let month = cursor.startOf('month');
      for (let i = 0; i < MAX_STEPS; i++) {
        if (end && month > end) return null;
        const monthsSince = (month.year - start.year) * 12 + (month.month - start.month);
        if (monthsSince % rule.interval === 0) {
          const candidate = month.set({ day: Math.min(day, month.daysInMonth!) });
          if (candidate >= cursor) return within(candidate);
        }
        month = month.plus({ months: 1 });
      }
      return null;
    }
  }
}

/** The occurrence after `date` in fixed-schedule mode. */
export function scheduledAfter(rule: RecurrenceRule, date: IsoDate): IsoDate | null {
  return scheduledOnOrAfter(rule, iso(d(date).plus({ days: 1 })));
}

/** After-completion mode: next due date counted from the day the previous occurrence was completed. */
export function afterCompletion(rule: RecurrenceRule, completedOn: IsoDate): IsoDate | null {
  const unit = { daily: 'days', weekly: 'weeks', monthly: 'months' } as const;
  const next = d(completedOn).plus({ [unit[rule.freq]]: rule.interval });
  if (rule.endDate && next > d(rule.endDate)) return null;
  return iso(next);
}
