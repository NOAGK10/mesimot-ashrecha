import { and, asc, desc, eq, gt, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { MessageDto, listMessagesQuerySchema, postMessageSchema } from '@org/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db/client';
import { chatMentions, chatMessages, people } from '../../db/schema';
import { forbidden, invalid, notFound } from '../../lib/errors';
import { policy } from '../identity/policy';
import type { Principal } from '../identity/principal';
import { addInboxItems } from '../inbox/inbox-service';
import { loadTask, type TaskWithParticipants } from '../tasks/task-store';

/**
 * Chat (APPROVED, docs/DECISIONS.md C-16): one general channel per organisation plus one channel per task.
 * Everyone who signs in may use the general channel; a task's channel follows the task's visibility.
 * Magic-link visitors have no chat. Messages never change tasks — work still lives in tasks.
 */

type MessageRow = typeof chatMessages.$inferSelect;

/** Resolves the channel and checks the caller may use it. Returns the task for task channels. */
async function openChannel(db: Db, p: Principal, taskId: string | null | undefined): Promise<TaskWithParticipants | null> {
  if (p.access === 'link') throw forbidden('Chat is available to signed-in users');
  if (!taskId) return null;
  const task = await loadTask(db, taskId);
  if (!task || !policy.canViewTask(p, task)) throw notFound('Task');
  return task;
}

function toDto(m: MessageRow, mentionIds: string[], p: Principal): MessageDto {
  const deleted = m.deletedAt !== null;
  return {
    id: m.id,
    taskId: m.taskId,
    authorPersonId: m.authorPersonId,
    body: deleted ? '' : m.body,
    mentionIds: deleted ? [] : mentionIds,
    createdAt: m.createdAt.toISOString(),
    deleted,
    canDelete: !deleted && (m.authorPersonId === p.personId || policy.isManager(p)),
  };
}

async function withMentions(db: Db, p: Principal, rows: MessageRow[]): Promise<MessageDto[]> {
  const ids = rows.map((r) => r.id);
  const mentions = ids.length ? await db.select().from(chatMentions).where(inArray(chatMentions.messageId, ids)) : [];
  return rows.map((r) => toDto(r, mentions.filter((m) => m.messageId === r.id).map((m) => m.personId), p));
}

/**
 * Newest page by default; `after` returns newer messages (polling), `before` older ones (history).
 * Always returned oldest-first.
 */
export async function listMessages(ctx: AppContext, p: Principal, q: z.output<typeof listMessagesQuerySchema>): Promise<MessageDto[]> {
  await openChannel(ctx.db, p, q.taskId);
  const where: SQL[] = [eq(chatMessages.orgId, p.orgId), q.taskId ? eq(chatMessages.taskId, q.taskId) : isNull(chatMessages.taskId)];
  if (q.after !== undefined) where.push(gt(chatMessages.id, q.after));
  if (q.before !== undefined) where.push(lt(chatMessages.id, q.before));
  const rows = await ctx.db
    .select()
    .from(chatMessages)
    .where(and(...where))
    .orderBy(q.after !== undefined ? asc(chatMessages.id) : desc(chatMessages.id))
    .limit(q.limit);
  if (q.after === undefined) rows.reverse();
  return withMentions(ctx.db, p, rows);
}

/** Who may be tagged: people who can sign in and can see the channel. */
async function assertMentionable(db: Db, p: Principal, task: TaskWithParticipants | null, mentionIds: string[]): Promise<void> {
  if (mentionIds.length === 0) return;
  const found = await db
    .select({ id: people.id, role: people.role })
    .from(people)
    .where(and(eq(people.orgId, p.orgId), inArray(people.id, mentionIds), isNull(people.deactivatedAt), sql`${people.role} is not null`));
  if (found.length !== mentionIds.length) throw invalid('Only people who sign in to the site can be tagged');
  if (task) {
    const involved = new Set([task.ownerPersonId, ...task.participantIds]);
    const outsider = found.find((f) => f.role === 'guest' && !involved.has(f.id));
    if (outsider) throw invalid('A tagged guest cannot see this task');
  }
}

export async function postMessage(ctx: AppContext, p: Principal, input: z.output<typeof postMessageSchema>): Promise<MessageDto> {
  const task = await openChannel(ctx.db, p, input.taskId);
  const mentionIds = [...new Set(input.mentionIds)];
  return ctx.db.transaction(async (tx) => {
    await assertMentionable(tx, p, task, mentionIds);
    const [message] = await tx
      .insert(chatMessages)
      .values({ orgId: p.orgId, taskId: input.taskId, authorPersonId: p.personId, body: input.body, createdAt: ctx.now() })
      .returning();
    if (mentionIds.length) {
      await tx.insert(chatMentions).values(mentionIds.map((personId) => ({ messageId: message!.id, personId })));
      await addInboxItems(
        tx,
        mentionIds.map((personId) => ({
          orgId: p.orgId,
          personId,
          kind: 'mention' as const,
          actorPersonId: p.personId,
          taskId: input.taskId,
          messageId: message!.id,
          createdAt: ctx.now(),
        })),
      );
    }
    return toDto(message!, mentionIds, p);
  });
}

/** Authors delete their own messages; managers may delete any. The message stays as "deleted". */
export async function deleteMessage(ctx: AppContext, p: Principal, id: number): Promise<void> {
  const [m] = await ctx.db.select().from(chatMessages).where(eq(chatMessages.id, id));
  if (!m || m.orgId !== p.orgId) throw notFound('Message');
  await openChannel(ctx.db, p, m.taskId);
  if (m.authorPersonId !== p.personId && !policy.isManager(p)) throw forbidden();
  if (m.deletedAt) return;
  await ctx.db.update(chatMessages).set({ deletedAt: ctx.now(), deletedByPersonId: p.personId }).where(eq(chatMessages.id, id));
}
