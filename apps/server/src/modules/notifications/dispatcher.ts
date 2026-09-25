import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { auditEvents, notifications, people } from '../../db/schema';
import { todayIn } from '../../lib/dates';
import { getOrg } from '../identity/org';
import { issueMagicLink } from '../identity/auth-service';
import { isOpen } from '../tasks/lifecycle';
import { loadTask } from '../tasks/task-store';
import { buildEmail } from './email-content';
import type { MailMessage } from './mailer';

type NotificationRow = typeof notifications.$inferSelect;

const BATCH = 20;
const MAX_ATTEMPTS = 5;
/** A row stuck in 'sending' this long is assumed abandoned by a crashed worker and retried. */
const STALE_CLAIM_MINUTES = 10;

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

  const org = await getOrg(ctx.db, task.orgId);
  // People with a login open the app; contacts without one get a task-scoped magic link.
  const url = person.role === null ? await issueMagicLink(ctx, ctx.db, person.id, task.id) : `${ctx.config.APP_URL}/tasks/${task.id}`;
  const [lastStatus] = await ctx.db
    .select({ data: auditEvents.data })
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, 'task'), eq(auditEvents.entityId, task.id), eq(auditEvents.type, 'task.status_changed')))
    .orderBy(desc(auditEvents.id))
    .limit(1);
  const note = lastStatus?.data.to === task.status && typeof lastStatus.data.note === 'string' ? lastStatus.data.note : null;

  return buildEmail({
    kind: n.kind,
    orgName: org.name,
    to: { name: person.displayName, email: person.email },
    isOwner: task.ownerPersonId === person.id,
    task: { title: task.title, description: task.description, status: task.status, dueDate: task.dueDate },
    statusNote: note,
    url,
    today: todayIn(org.timezone, ctx.now()),
  });
}
