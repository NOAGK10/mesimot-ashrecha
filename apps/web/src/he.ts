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
  'task.category_changed': 'הקטגוריה שונתה',
  'task.visibility_changed': 'השתנה מי רואה את המשימה',
  'task.deleted': 'המשימה נמחקה',
};

export const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export const formatDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });

// ---------------- Hebrew calendar ----------------

const GEMATRIA: [number, string][] = [
  [400, 'ת'], [300, 'ש'], [200, 'ר'], [100, 'ק'], [90, 'צ'], [80, 'פ'], [70, 'ע'], [60, 'ס'], [50, 'נ'],
  [40, 'מ'], [30, 'ל'], [20, 'כ'], [10, 'י'], [9, 'ט'], [8, 'ח'], [7, 'ז'], [6, 'ו'], [5, 'ה'], [4, 'ד'], [3, 'ג'], [2, 'ב'], [1, 'א'],
];

/** 29 → כ״ט, 15 → ט״ו, 5787 → תשפ״ז (thousands are dropped, as is customary). */
export function hebrewNumeral(n: number): string {
  let rest = n % 1000;
  let out = '';
  for (const [value, letter] of GEMATRIA) {
    if (rest === 15 || rest === 16) {
      out += rest === 15 ? 'טו' : 'טז';
      rest = 0;
      break;
    }
    while (rest >= value) {
      out += letter;
      rest -= value;
    }
  }
  return out.length === 1 ? `${out}׳` : `${out.slice(0, -1)}״${out.slice(-1)}`;
}

const hebrewParts = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' });
const part = (d: Date, type: string) => hebrewParts.formatToParts(d).find((p) => p.type === type)?.value ?? '';

/** The Hebrew day of the month, e.g. כ״ט. */
export const hebrewDay = (d: Date) => hebrewNumeral(Number(part(d, 'day')));
/** e.g. חשוון תשפ״ז */
export const hebrewMonthYear = (d: Date) => `${part(d, 'month')} ${hebrewNumeral(Number(part(d, 'year')))}`;
/** e.g. נובמבר 2026 */
export const gregorianMonthYear = (d: Date) => new Intl.DateTimeFormat('he', { month: 'long', year: 'numeric' }).format(d);

/** Chat times: 14:05 for today, אתמול, otherwise 07/11. */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'אתמול';
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}
export const clockTime = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

/** Day separator in a chat: "היום · כ״ט חשוון תשפ״ז", "יום שלישי, 3 בנובמבר · …". */
export function chatDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const head =
    d.toDateString() === now.toDateString()
      ? 'היום'
      : d.toDateString() === yesterday.toDateString()
        ? 'אתמול'
        : d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  return `${head} · ${hebrewDay(d)} ${hebrewMonthYear(d)}`;
}
