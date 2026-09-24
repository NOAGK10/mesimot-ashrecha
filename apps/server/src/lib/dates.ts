import { DateTime } from 'luxon';

/** Calendar dates are ISO strings (YYYY-MM-DD); instants are Date objects. */
export type IsoDate = string;

export function todayIn(timezone: string, now: Date): IsoDate {
  return DateTime.fromJSDate(now, { zone: timezone }).toISODate()!;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate()!;
}

/** Last day (Saturday) of the Sunday-based week containing `date`. */
export function endOfWeek(date: IsoDate): IsoDate {
  const d = DateTime.fromISO(date, { zone: 'utc' });
  const weekdaySun0 = d.weekday % 7; // luxon: Mon=1 … Sun=7
  return d.plus({ days: 6 - weekdaySun0 }).toISODate()!;
}

/** The instant of `hour`:00 local time on `date` in `timezone`. */
export function localHourToInstant(date: IsoDate, hour: number, timezone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return DateTime.fromObject({ year: y, month: m, day: d, hour }, { zone: timezone }).toJSDate();
}
