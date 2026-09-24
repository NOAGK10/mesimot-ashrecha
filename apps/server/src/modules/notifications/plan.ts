import { addDays, localHourToInstant, type IsoDate } from '../../lib/dates';

export type DateReminderKind = 'due_soon' | 'due_today' | 'overdue';

export interface ReminderSettings {
  timezone: string;
  reminderHour: number;
  dueSoonDays: number;
}

export interface PlannedReminder {
  personId: string;
  kind: DateReminderKind;
  sendAt: Date;
}

/**
 * Date-driven reminders for one open task (PROPOSED — docs/DECISIONS.md, D7):
 * `dueSoonDays` before, on the day, and the day after if still open. Reminders whose time
 * has already passed are not planned, so editing a task never produces a burst of stale mail.
 */
export function planDateReminders(
  dueDate: IsoDate | null,
  recipients: readonly string[],
  settings: ReminderSettings,
  now: Date,
): PlannedReminder[] {
  if (!dueDate) return [];
  const at = (date: IsoDate) => localHourToInstant(date, settings.reminderHour, settings.timezone);
  const moments: Array<[DateReminderKind, Date]> = [
    ['due_today', at(dueDate)],
    ['overdue', at(addDays(dueDate, 1))],
  ];
  if (settings.dueSoonDays > 0) moments.unshift(['due_soon', at(addDays(dueDate, -settings.dueSoonDays))]);

  const unique = [...new Set(recipients)];
  return moments
    .filter(([, sendAt]) => sendAt > now)
    .flatMap(([kind, sendAt]) => unique.map((personId) => ({ personId, kind, sendAt })));
}
