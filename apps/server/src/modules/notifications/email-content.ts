import type { TaskStatus } from '@org/shared';
import { addDays, type IsoDate } from '../../lib/dates';
import type { MailMessage } from './mailer';

/** Wording of notification e-mails (Hebrew). Pure, so the text can be reviewed and tested on its own. */

export type NotificationKind = 'assigned' | 'due_soon' | 'due_today' | 'overdue';

export interface EmailInput {
  kind: NotificationKind;
  orgName: string;
  to: { name: string; email: string };
  isOwner: boolean;
  task: { title: string; description: string; status: TaskStatus; dueDate: IsoDate | null };
  /** Note written with the latest status change, if the task is still in that status. */
  statusNote: string | null;
  url: string;
  today: IsoDate;
}

const STATUS: Record<TaskStatus, string> = {
  new: 'חדש',
  in_progress: 'בביצוע',
  waiting: 'ממתין',
  blocked: 'תקוע',
  completed: 'הושלם',
  cancelled: 'בוטל',
};

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/** "היום", "מחר", or the date — how people naturally talk about a due date. */
function whenDue(due: IsoDate, today: IsoDate): string {
  if (due === today) return 'היום';
  if (due === addDays(today, 1)) return 'מחר';
  return `ב-${formatDate(due)}`;
}

function subjectOf(i: EmailInput): string {
  const t = i.task.title;
  const due = i.task.dueDate;
  switch (i.kind) {
    case 'assigned':
      return `${i.orgName} · משימה חדשה: ${t}`;
    case 'due_soon':
      return `${i.orgName} · תזכורת: ${t}${due ? ` (יעד ${whenDue(due, i.today)})` : ''}`;
    case 'due_today':
      return `${i.orgName} · היום: ${t}`;
    case 'overdue':
      return `${i.orgName} · באיחור: ${t}`;
  }
}

function introOf(i: EmailInput): string {
  const due = i.task.dueDate;
  switch (i.kind) {
    case 'assigned':
      return i.isOwner ? 'נוספה משימה חדשה באחריותך.' : 'צורפת כמשתתף במשימה.';
    case 'due_soon':
      return `תזכורת: ${due ? whenDue(due, i.today) : 'בקרוב'} מועד היעד של המשימה הזו.`;
    case 'due_today':
      return 'היום מועד היעד של המשימה הזו.';
    case 'overdue':
      return `מועד היעד${due ? ` (${formatDate(due)})` : ''} עבר, והמשימה עדיין פתוחה.`;
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

export function buildEmail(i: EmailInput): MailMessage {
  const role = i.isOwner ? 'האחריות שלך' : 'אתה משתתף';
  const facts = [
    `${role} · סטטוס: ${STATUS[i.task.status]}`,
    ...(i.task.dueDate ? [`יעד: ${formatDate(i.task.dueDate)}`] : []),
  ];
  const details = i.task.description.trim() ? clip(i.task.description.trim(), 500) : '';
  const note = i.statusNote ? `${STATUS[i.task.status]}: ${i.statusNote}` : '';

  const text = [
    `שלום ${i.to.name},`,
    '',
    introOf(i),
    '',
    i.task.title,
    ...facts,
    ...(note ? [note] : []),
    ...(details ? ['', `פרטים: ${details}`] : []),
    '',
    `לפתיחת המשימה: ${i.url}`,
    '',
    'בהצלחה,',
    i.orgName,
  ].join('\n');

  const p = (s: string) => `<p style="margin:0 0 12px">${s}</p>`;
  const html = `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1c2230;max-width:560px">
${p(`שלום ${escapeHtml(i.to.name)},`)}
${p(escapeHtml(introOf(i)))}
<div style="border:1px solid #dde2e8;border-radius:10px;padding:12px 16px;margin:0 0 16px">
<div style="font-size:17px;font-weight:bold;margin-bottom:4px">${escapeHtml(i.task.title)}</div>
${facts.map((f) => `<div style="color:#5f6b7a">${escapeHtml(f)}</div>`).join('')}
${note ? `<div style="margin-top:8px;padding:6px 10px;background:#fff4e5;border-radius:6px">${escapeHtml(note)}</div>` : ''}
${details ? `<div style="margin-top:8px;white-space:pre-wrap">${escapeHtml(details)}</div>` : ''}
</div>
<p style="margin:0 0 20px"><a href="${escapeHtml(i.url)}" style="background:#2456c9;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">לפתיחת המשימה</a></p>
${p(`בהצלחה,<br>${escapeHtml(i.orgName)}`)}
</div>`;

  return { to: i.to.email, subject: subjectOf(i), text, html };
}
