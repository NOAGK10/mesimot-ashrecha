import { describe, expect, it } from 'vitest';
import { buildEmail, type EmailInput } from '../modules/notifications/email-content';

const base: EmailInput = {
  kind: 'due_soon',
  orgName: 'אשריך',
  to: { name: 'דנה', email: 'dana@example.org' },
  isOwner: true,
  task: { title: 'להזמין כיסאות', description: 'לאולם, 120 כיסאות', status: 'in_progress', dueDate: '2026-10-05' },
  statusNote: null,
  url: 'https://app.test/tasks/1',
  today: '2026-10-04',
};

describe('notification e-mails', () => {
  it('names the organisation and says when the task is due in plain words', () => {
    const m = buildEmail(base);
    expect(m.subject).toBe('אשריך · תזכורת: להזמין כיסאות (יעד מחר)');
    expect(m.text).toContain('תזכורת: מחר מועד היעד של המשימה הזו.');
    expect(m.text).toContain('האחריות שלך · סטטוס: בביצוע');
    expect(m.text).toContain('פרטים: לאולם, 120 כיסאות');
    expect(m.text.trim().endsWith('בהצלחה,\nאשריך')).toBe(true);
  });

  it('distinguishes owners from participants and uses the date when it is further away', () => {
    const m = buildEmail({ ...base, isOwner: false, today: '2026-10-01' });
    expect(m.subject).toBe('אשריך · תזכורת: להזמין כיסאות (יעד ב-05/10/2026)');
    expect(m.text).toContain('אתה משתתף');
    expect(buildEmail({ ...base, kind: 'assigned', isOwner: false }).text).toContain('צורפת כמשתתף במשימה.');
  });

  it('includes the latest status note, e.g. why a task is stuck', () => {
    const m = buildEmail({ ...base, kind: 'overdue', task: { ...base.task, status: 'blocked' }, statusNote: 'מחכים להצעת מחיר', today: '2026-10-06' });
    expect(m.subject).toBe('אשריך · באיחור: להזמין כיסאות');
    expect(m.text).toContain('מועד היעד (05/10/2026) עבר, והמשימה עדיין פתוחה.');
    expect(m.text).toContain('תקוע: מחכים להצעת מחיר');
    expect(m.html).toContain('מחכים להצעת מחיר');
  });

  it('escapes task text in the HTML version', () => {
    const m = buildEmail({ ...base, task: { ...base.task, title: '<script>x</script>' } });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
  });
});
