import { and, desc, eq, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { auditEvents, chatMessages, notifications, people, personFeedback } from '../../db/schema';
import { todayIn } from '../../lib/dates';
import { getOrg } from '../identity/org';
import { issueMagicLink } from '../identity/auth-service';
import { isOpen } from '../tasks/lifecycle';
import { loadTask } from '../tasks/task-store';
import { buildEmail, buildSocialEmail, type NotificationKind } from './email-content';
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
  if (n.kind === 'mention' || n.kind === 'feedback') return buildSocialMessage(ctx, n);
  if (!n.taskId) return null;
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
    kind: n.kind as NotificationKind,
    orgName: org.name,
    to: { name: person.displayName, email: person.email },
    isOwner: task.ownerPersonId === person.id,
    task: { title: task.title, description: task.description, status: task.status, dueDate: task.dueDate },
    statusNote: note,
    url,
    today: todayIn(org.timezone, ctx.now()),
  });
}

/** E-mail for a tag in a chat or for new feedback. Skipped if the message/feedback was deleted or the person left. */
async function buildSocialMessage(ctx: AppContext, n: NotificationRow): Promise<MailMessage | null> {
  const [person] = await ctx.db.select().from(people).where(eq(people.id, n.personId));
  if (!person || person.deactivatedAt || person.role === null) return null;
  const org = await getOrg(ctx.db, n.orgId);
  const base = ctx.config.APP_URL;

  if (n.kind === 'mention') {
    if (!n.messageId) return null;
    const [m] = await ctx.db.select().from(chatMessages).where(eq(chatMessages.id, n.messageId));
    if (!m || m.deletedAt) return null;
    const task = m.taskId ? await loadTask(ctx.db, m.taskId) : null;
    if (m.taskId && (!task || task.archivedAt)) return null;
    const [author] = await ctx.db.select({ name: people.displayName }).from(people).where(eq(people.id, m.authorPersonId));
    return buildSocialEmail({
      kind: 'mention',
      orgName: org.name,
      to: { name: person.displayName, email: person.email },
      actorName: author?.name ?? 'מישהו',
      taskTitle: task?.title ?? null,
      body: m.body,
      url: task ? `${base}/tasks/${task.id}#m${m.id}` : `${base}/chat#m${m.id}`,
    });
  }

  if (!n.feedbackId) return null;
  const [f] = await ctx.db.select().from(personFeedback).where(eq(personFeedback.id, n.feedbackId));
  if (!f || f.deletedAt) return null;
  const [author] = await ctx.db.select({ name: people.displayName }).from(people).where(eq(people.id, f.authorPersonId));
  return buildSocialEmail({
    kind: 'feedback',
    orgName: org.name,
    to: { name: person.displayName, email: person.email },
    actorName: author?.name ?? 'מישהו',
    taskTitle: null,
    body: f.body,
    url: `${base}/people/${person.id}#feedback`,
  });
}
