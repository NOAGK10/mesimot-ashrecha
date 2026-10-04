import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { InboxItemDto, InboxKind } from '@org/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db/client';
import { chatMessages, inboxItems, notifications, people, personFeedback, tasks } from '../../db/schema';
import type { Principal } from '../identity/principal';

/**
 * In-app notifications ("inbox") shown on each person's home page.
 * Only people who can sign in get inbox items; contacts are reached by e-mail instead.
 */

export interface NewInboxItem {
  orgId: string;
  personId: string;
  kind: InboxKind;
  actorPersonId: string | null;
  taskId?: string | null;
  messageId?: number | null;
  feedbackId?: number | null;
  createdAt?: Date;
}

/** Adds items inside the caller's transaction, skipping the actor and people without a login. */
export async function addInboxItems(tx: Db, items: NewInboxItem[]): Promise<void> {
  const wanted = items.filter((i) => i.personId !== i.actorPersonId);
  if (wanted.length === 0) return;
  const canSignIn = await tx
    .select({ id: people.id })
    .from(people)
    .where(and(inArray(people.id, [...new Set(wanted.map((i) => i.personId))]), sql`${people.role} is not null`, isNull(people.deactivatedAt)));
  const allowed = new Set(canSignIn.map((r) => r.id));
  const rows = wanted.filter((i) => allowed.has(i.personId));
  if (rows.length === 0) return;
  await tx.insert(inboxItems).values(rows);

  // Tags and feedback are also e-mailed (APPROVED, docs/DECISIONS.md C-24). "Task assigned" already
  // has its own e-mail from notifyAssigned, so it is not queued twice.
  const emailed = rows.filter((i) => i.kind === 'mention' || i.kind === 'feedback');
  if (emailed.length) {
    await tx.insert(notifications).values(
      emailed.map((i) => ({
        orgId: i.orgId,
        personId: i.personId,
        kind: i.kind as 'mention' | 'feedback',
        taskId: i.taskId ?? null,
        messageId: i.messageId ?? null,
        feedbackId: i.feedbackId ?? null,
        sendAt: i.createdAt ?? new Date(),
      })),
    );
  }
}

const EXCERPT = 140;

export async function listInbox(ctx: AppContext, p: Principal, limit = 50): Promise<InboxItemDto[]> {
  const rows = await ctx.db
    .select({
      item: inboxItems,
      taskTitle: tasks.title,
      taskDueDate: tasks.dueDate,
      body: sql<string | null>`coalesce(${chatMessages.body}, ${personFeedback.body})`,
      deletedAt: sql<Date | null>`coalesce(${chatMessages.deletedAt}, ${personFeedback.deletedAt})`,
    })
    .from(inboxItems)
    .leftJoin(tasks, eq(tasks.id, inboxItems.taskId))
    .leftJoin(chatMessages, eq(chatMessages.id, inboxItems.messageId))
    .leftJoin(personFeedback, eq(personFeedback.id, inboxItems.feedbackId))
    .where(and(eq(inboxItems.personId, p.personId), isNull(tasks.deletedAt)))
    .orderBy(desc(inboxItems.id))
    .limit(limit);
  return rows.map(({ item, taskTitle, taskDueDate, body, deletedAt }) => ({
    id: item.id,
    kind: item.kind,
    actorPersonId: item.actorPersonId,
    taskId: item.taskId,
    taskTitle: taskTitle ?? null,
    taskDueDate: taskDueDate ?? null,
    messageId: item.messageId,
    excerpt: body && !deletedAt ? (body.length > EXCERPT ? `${body.slice(0, EXCERPT).trimEnd()}…` : body) : null,
    createdAt: item.createdAt.toISOString(),
    read: item.readAt !== null,
  }));
}

export async function unreadCount(ctx: AppContext, p: Principal): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(inboxItems)
    .where(and(eq(inboxItems.personId, p.personId), isNull(inboxItems.readAt)));
  return row?.n ?? 0;
}

/** Marks the caller's own items as read; ids belonging to someone else are ignored. */
export async function markRead(ctx: AppContext, p: Principal, which: { ids: number[] } | { all: true }): Promise<void> {
  const mine = and(eq(inboxItems.personId, p.personId), isNull(inboxItems.readAt));
  await ctx.db
    .update(inboxItems)
    .set({ readAt: ctx.now() })
    .where('all' in which ? mine : and(mine, inArray(inboxItems.id, which.ids)));
}
