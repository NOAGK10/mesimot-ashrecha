import { eq, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { notifications, people } from '../../db/schema';
import { issueMagicLink } from '../identity/auth-service';
import { isOpen } from '../tasks/lifecycle';
import { loadTask } from '../tasks/task-store';
import type { MailMessage } from './mailer';

type NotificationRow = typeof notifications.$inferSelect;

const BATCH = 20;
const MAX_ATTEMPTS = 5;
/** A row stuck in 'sending' this long is assumed abandoned by a crashed worker and retried. */
const STALE_CLAIM_MINUTES = 10;

const SUBJECTS: Record<NotificationRow['kind'], (title: string) => string> = {
  assigned: (t) => `משימה חדשה עבורך: ${t}`,
  due_soon: (t) => `תזכורת: ${t}`,
  due_today: (t) => `היום: ${t}`,
  overdue: (t) => `באיחור: ${t}`,
};
const INTROS: Record<NotificationRow['kind'], string> = {
  assigned: 'שובצת למשימה.',
  due_soon: 'מועד היעד של המשימה מתקרב.',
  due_today: 'מועד היעד של המשימה הוא היום.',
  overdue: 'מועד היעד של המשימה עבר והיא עדיין פתוחה.',
};

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const formatDate = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : 'ללא');

/**
 * Claims due notifications with SKIP LOCKED, so several worker instances never send the same row,
 * then delivers each one outside the claiming transaction. Delivery is at-least-once: a crash between
 * sending and marking 'sent' can cause one duplicate after STALE_CLAIM_MINUTES.
 */
export async function dispatchDueNotifications(ctx: AppContext): Promise<{ sent: number; failed: number; cancelled: number }> {
  const now = ctx.now();
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MINUTES * 60_000);
  const claimed = (await ctx.db.execute(sql`
    update ${notifications} set status = 'sending', claimed_at = ${now}, attempts = attempts + 1
    where id in (
      select id from ${notifications}
      where (status = 'pending' and send_at <= ${now})
         or (status = 'sending' and claimed_at < ${staleBefore})
      order by send_at
      limit ${BATCH}
      for update skip locked
    )
    returning id`)) as { rows: Array<{ id: string }> };
  const ids = claimed.rows.map((r) => r.id);

  const result = { sent: 0, failed: 0, cancelled: 0 };
  for (const id of ids) {
    const [n] = await ctx.db.select().from(notifications).where(eq(notifications.id, id));
    if (!n) continue;
    try {
      const message = await buildMessage(ctx, n);
      if (!message) {
        await ctx.db.update(notifications).set({ status: 'cancelled' }).where(eq(notifications.id, id));
        result.cancelled++;
        continue;
      }
      await ctx.mailer.send(message);
      await ctx.db.update(notifications).set({ status: 'sent', sentAt: ctx.now(), lastError: null }).where(eq(notifications.id, id));
      result.sent++;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const giveUp = n.attempts >= MAX_ATTEMPTS;
      const retryAt = new Date(ctx.now().getTime() + 2 ** n.attempts * 60_000);
      await ctx.db
        .update(notifications)
        .set(giveUp ? { status: 'failed', lastError: error } : { status: 'pending', sendAt: retryAt, lastError: error })
        .where(eq(notifications.id, id));
      ctx.log.warn({ notificationId: id, attempts: n.attempts, err: error }, giveUp ? 'notification failed permanently' : 'notification will be retried');
      if (giveUp) result.failed++;
    }
  }
  return result;
}

/** Returns null when the message is no longer relevant (task closed, person removed, …). */
async function buildMessage(ctx: AppContext, n: NotificationRow): Promise<MailMessage | null> {
  const task = await loadTask(ctx.db, n.taskId);
  const [person] = await ctx.db.select().from(people).where(eq(people.id, n.personId));
  if (!task || !person || person.deactivatedAt) return null;
  if (task.archivedAt || (n.kind !== 'assigned' && !isOpen(task.status))) return null;
  if (task.ownerPersonId !== person.id && !task.participantIds.includes(person.id)) return null;

  // People with a login open the app; contacts without one get a task-scoped magic link.
  const url = person.role === null ? await issueMagicLink(ctx, ctx.db, person.id, task.id) : `${ctx.config.APP_URL}/tasks/${task.id}`;
  const role = task.ownerPersonId === person.id ? 'אחראי' : 'משתתף';
  const subject = SUBJECTS[n.kind](task.title);
  const lines = [`שלום ${person.displayName},`, '', INTROS[n.kind], '', `משימה: ${task.title}`, `תפקידך: ${role}`, `יעד: ${formatDate(task.dueDate)}`, '', `לצפייה במשימה: ${url}`];
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.6">
<p>שלום ${escapeHtml(person.displayName)},</p><p>${INTROS[n.kind]}</p>
<p><strong>${escapeHtml(task.title)}</strong><br>תפקידך: ${role}<br>יעד: ${formatDate(task.dueDate)}</p>
<p><a href="${escapeHtml(url)}">לצפייה במשימה</a></p></div>`;
  return { to: person.email, subject, text: lines.join('\n'), html };
}
