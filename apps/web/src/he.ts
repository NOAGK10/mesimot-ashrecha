import type { PersonRole, TaskStatus, TaskView } from '@org/shared';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  new: 'חדש',
  in_progress: 'בביצוע',
  waiting: 'ממתין',
  blocked: 'תקוע',
  completed: 'הושלם',
  cancelled: 'בוטל',
};

/** Button text for moving *to* a status. */
export function transitionLabel(from: TaskStatus, to: TaskStatus): string {
  if (to === 'in_progress') return from === 'completed' ? 'פתיחה מחדש' : from === 'new' ? 'התחלת עבודה' : 'חזרה לביצוע';
  if (to === 'waiting') return 'ממתין למשהו';
  if (to === 'blocked') return 'תקוע';
  if (to === 'completed') return 'הושלם ✓';
  if (to === 'cancelled') return 'ביטול';
  return 'שחזור';
}

export const VIEW_LABEL: Record<TaskView, string> = {
  all: 'הכל',
  today: 'להיום',
  week: 'לשבוע הזה',
  overdue: 'באיחור',
  future: 'משבוע הבא והלאה',
  undated: 'בלי תאריך יעד',
};

/** Access level (what someone may do in the system) — distinct from their job title in the organisation. */
export const roleLabel = (role: PersonRole) =>
  role === 'manager' ? 'מנהל' : role === 'member' ? 'משתמש קבוע' : role === 'guest' ? 'אורח' : 'איש קשר';
export const roleHint = (role: PersonRole) =>
  role === 'manager'
    ? 'רואה ומנהל את כל המשימות'
    : role === 'member'
      ? 'רואה את כל המשימות, מעדכן את שלו ויוצר משימות לעצמו'
      : role === 'guest'
      ? 'נכנס עם Google ורואה רק את המשימות שלו'
      : 'בלי כניסה לאתר. מקבל מיילים עם קישור למשימה';

export const EVENT_LABEL: Record<string, string> = {
  'task.created': 'המשימה נוצרה',
  'task.updated': 'פרטי המשימה עודכנו',
  'task.status_changed': 'הסטטוס שונה',
  'task.owner_changed': 'האחראי הוחלף',
  'task.due_date_changed': 'מועד היעד שונה',
  'task.participants_changed': 'המשתתפים עודכנו',
  'task.archived': 'המשימה הועברה לארכיון',
  'task.unarchived': 'המשימה הוחזרה מהארכיון',
  'task.link_issued': 'נוצר קישור גישה',
  'task.document_linked': 'קושר מסמך',
  'task.document_unlinked': 'הוסר מסמך',
};

export const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export const formatDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
