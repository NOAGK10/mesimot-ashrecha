import type { PersonRole, TaskStatus, TaskView } from '@org/shared';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: 'חדשה',
  in_progress: 'בביצוע',
  waiting: 'ממתינה',
  completed: 'הושלמה',
  cancelled: 'בוטלה',
};

/** Button text for moving *to* a status. */
export function transitionLabel(from: TaskStatus, to: TaskStatus): string {
  if (to === 'in_progress') return from === 'completed' ? 'פתיחה מחדש' : from === 'waiting' ? 'חזרה לביצוע' : 'התחלת עבודה';
  if (to === 'waiting') return 'ממתינה למשהו';
  if (to === 'completed') return 'סימון כהושלמה';
  if (to === 'cancelled') return 'ביטול המשימה';
  return 'שחזור';
}

export const VIEW_LABEL: Record<TaskView, string> = {
  all: 'הכל',
  today: 'היום',
  week: 'השבוע',
  overdue: 'באיחור',
  future: 'בהמשך',
  undated: 'ללא תאריך',
};

export const roleLabel = (role: PersonRole) =>
  role === 'manager' ? 'מנהל/ת' : role === 'guest' ? 'משתמש/ת אורח/ת' : 'איש/אשת קשר (מייל וקישור בלבד)';

export const EVENT_LABEL: Record<string, string> = {
  'task.created': 'המשימה נוצרה',
  'task.updated': 'פרטי המשימה עודכנו',
  'task.status_changed': 'הסטטוס שונה',
  'task.owner_changed': 'האחראי/ת הוחלף/ה',
  'task.due_date_changed': 'מועד היעד שונה',
  'task.participants_changed': 'המשתתפים עודכנו',
  'task.archived': 'המשימה הועברה לארכיון',
  'task.unarchived': 'המשימה הוחזרה מהארכיון',
  'task.link_issued': 'נוצר קישור גישה',
};

export const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export const formatDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
