import { and, asc, desc, eq, gt, inArray, isNull, like, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  MAX_CHAT_FILE_BYTES,
  type ChatAttachmentDto,
  type ChatChannelDto,
  type ChatReceiptDto,
  type MessageDto,
  type chatChannelQuerySchema,
  type listMessagesQuerySchema,
  type markChatReadSchema,
  type postMessageSchema,
} from '@org/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db/client';
import { chatAttachments, chatMentions, chatMessages, chatReads, people } from '../../db/schema';
import { forbidden, invalid, notFound } from '../../lib/errors';
import { policy } from '../identity/policy';
import type { Principal } from '../identity/principal';
import { addInboxItems } from '../inbox/inbox-service';
import { loadTask, type TaskWithParticipants } from '../tasks/task-store';

/**
 * Chat (APPROVED, docs/DECISIONS.md C-16): one general channel per organisation, one channel per task,
 * and private conversations between two people.
 * Everyone who signs in may use the general channel; a task's channel follows the task's visibility;
 * a private conversation is open only to its two people (managers included – nobody else reads it).
 * Magic-link visitors have no chat. Messages never change tasks — work still lives in tasks.
 */

type MessageRow = typeof chatMessages.$inferSelect;
type PostOutput = z.output<typeof postMessageSchema>;
/** A new message; the private-conversation and attachment fields are optional. */
export type PostMessageInput = Omit<PostOutput, 'withPersonId' | 'attachment'> & Partial<Pick<PostOutput, 'withPersonId' | 'attachment'>>;
type AttachmentRow = Omit<typeof chatAttachments.$inferSelect, 'dataBase64'>;

type Channel =
  | { kind: 'general' }
  | { kind: 'task'; task: TaskWithParticipants }
  | { kind: 'dm'; key: string; otherPersonId: string };

const dmKeyOf = (a: string, b: string) => [a, b].sort().join(':');
const channelKey = (c: Channel) => (c.kind === 'general' ? 'general' : c.kind === 'task' ? `task:${c.task.id}` : `dm:${c.key}`);

function channelWhere(p: Principal, c: Channel): SQL {
  const org = eq(chatMessages.orgId, p.orgId);
  if (c.kind === 'task') return and(org, eq(chatMessages.taskId, c.task.id))!;
  if (c.kind === 'dm') return and(org, eq(chatMessages.dmKey, c.key))!;
  return and(org, isNull(chatMessages.taskId), isNull(chatMessages.dmKey))!;
}

/** Resolves the conversation and checks the caller may use it. */
async function openChannel(db: Db, p: Principal, q: { taskId?: string | null; withPersonId?: string | null }): Promise<Channel> {
  if (p.access === 'link') throw forbidden('Chat is available to signed-in users');
  if (q.taskId && q.withPersonId) throw invalid('A conversation is about a task or with a person, not both');
  if (q.taskId) {
    const task = await loadTask(db, q.taskId);
    if (!task || task.deletedAt || !policy.canViewTask(p, task)) throw notFound('Task');
    return { kind: 'task', task };
  }
  if (q.withPersonId) {
    if (q.withPersonId === p.personId) throw invalid('Choose someone else to talk to');
    const [other] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, q.withPersonId), eq(people.orgId, p.orgId), isNull(people.deletedAt), sql`${people.role} is not null`));
    if (!other) throw notFound('Person');
    return { kind: 'dm', key: dmKeyOf(p.personId, other.id), otherPersonId: other.id };
  }
  return { kind: 'general' };
}

/** The conversation an existing message belongs to (used for deleting and for opening its file). */
async function channelOfMessage(db: Db, p: Principal, m: MessageRow): Promise<Channel> {
  if (m.dmKey) {
    const [a, b] = m.dmKey.split(':');
    if (p.personId !== a && p.personId !== b) throw notFound('Message');
    return openChannel(db, p, { withPersonId: p.personId === a ? b : a });
  }
  return openChannel(db, p, { taskId: m.taskId });
}

function attachmentDto(a: AttachmentRow): ChatAttachmentDto {
  return { id: a.id, kind: a.kind, fileName: a.fileName, mimeType: a.mimeType, sizeBytes: a.sizeBytes, durationMs: a.durationMs };
}

function toDto(m: MessageRow, mentionIds: string[], attachment: AttachmentRow | undefined, p: Principal): MessageDto {
  const deleted = m.deletedAt !== null;
  return {
    id: m.id,
    taskId: m.taskId,
    dmPersonIds: m.dmKey ? (m.dmKey.split(':') as [string, string]) : null,
    authorPersonId: m.authorPersonId,
    body: deleted ? '' : m.body,
    mentionIds: deleted ? [] : mentionIds,
    attachment: !deleted && attachment ? attachmentDto(attachment) : null,
    createdAt: m.createdAt.toISOString(),
    deleted,
    canDelete: !deleted && (m.authorPersonId === p.personId || policy.isManager(p)),
  };
}

const attachmentColumns = {
  id: chatAttachments.id,
  orgId: chatAttachments.orgId,
  uploaderPersonId: chatAttachments.uploaderPersonId,
  kind: chatAttachments.kind,
  fileName: chatAttachments.fileName,
  mimeType: chatAttachments.mimeType,
  sizeBytes: chatAttachments.sizeBytes,
  durationMs: chatAttachments.durationMs,
  createdAt: chatAttachments.createdAt,
};

async function withDetails(db: Db, p: Principal, rows: MessageRow[]): Promise<MessageDto[]> {
  const ids = rows.map((r) => r.id);
  const mentions = ids.length ? await db.select().from(chatMentions).where(inArray(chatMentions.messageId, ids)) : [];
  const fileIds = rows.map((r) => r.attachmentId).filter((x): x is number => x !== null);
  const files = fileIds.length ? await db.select(attachmentColumns).from(chatAttachments).where(inArray(chatAttachments.id, fileIds)) : [];
  return rows.map((r) =>
    toDto(
      r,
      mentions.filter((m) => m.messageId === r.id).map((m) => m.personId),
      files.find((f) => f.id === r.attachmentId),
      p,
    ),
  );
}

/**
 * Newest page by default; `after` returns newer messages (polling), `before` older ones (history).
 * Always returned oldest-first.
 */
export async function listMessages(ctx: AppContext, p: Principal, q: z.output<typeof listMessagesQuerySchema>): Promise<MessageDto[]> {
  const channel = await openChannel(ctx.db, p, q);
  const where: SQL[] = [channelWhere(p, channel)];
  if (q.after !== undefined) where.push(gt(chatMessages.id, q.after));
  if (q.before !== undefined) where.push(lt(chatMessages.id, q.before));
  const rows = await ctx.db
    .select()
    .from(chatMessages)
    .where(and(...where))
    .orderBy(q.after !== undefined ? asc(chatMessages.id) : desc(chatMessages.id))
    .limit(q.limit);
  if (q.after === undefined) rows.reverse();
  return withDetails(ctx.db, p, rows);
}

/** SQL for the conversation a message row belongs to, matching channelKey(). */
const keyExpr = sql<string>`case when ${chatMessages.taskId} is not null then 'task:' || ${chatMessages.taskId} when ${chatMessages.dmKey} is not null then 'dm:' || ${chatMessages.dmKey} else 'general' end`;

/**
 * Conversations for the chat sidebar, most recent first: the general channel (always listed),
 * every task conversation the caller may see, and the caller's private conversations –
 * each with the number of messages from others the caller has not read yet.
 */
export async function listChannels(ctx: AppContext, p: Principal): Promise<ChatChannelDto[]> {
  await openChannel(ctx.db, p, {});
  const mine = or(isNull(chatMessages.dmKey), like(chatMessages.dmKey, `%${p.personId}%`))!;
  const latest = await ctx.db
    .select({ id: sql<number>`max(${chatMessages.id})`.mapWith(Number) })
    .from(chatMessages)
    .where(and(eq(chatMessages.orgId, p.orgId), mine))
    .groupBy(keyExpr);
  const unreadRows = await ctx.db
    .select({ key: keyExpr, n: sql<number>`count(*)`.mapWith(Number) })
    .from(chatMessages)
    .leftJoin(chatReads, and(eq(chatReads.personId, p.personId), eq(chatReads.channelKey, keyExpr)))
    .where(
      and(
        eq(chatMessages.orgId, p.orgId),
        mine,
        ne(chatMessages.authorPersonId, p.personId),
        isNull(chatMessages.deletedAt),
        sql`${chatMessages.id} > coalesce(${chatReads.lastReadId}, 0)`,
      ),
    )
    .groupBy(keyExpr);
  const unread = new Map(unreadRows.map((u) => [u.key, u.n]));

  const ids = latest.map((l) => l.id);
  const rows = ids.length ? await ctx.db.select().from(chatMessages).where(inArray(chatMessages.id, ids)) : [];
  const fileIds = rows.map((r) => r.attachmentId).filter((x): x is number => x !== null);
  const kinds = fileIds.length
    ? await ctx.db.select({ id: chatAttachments.id, kind: chatAttachments.kind }).from(chatAttachments).where(inArray(chatAttachments.id, fileIds))
    : [];
  const last = (m: MessageRow) => ({
    authorPersonId: m.authorPersonId,
    body: m.deletedAt ? '' : m.body,
    createdAt: m.createdAt.toISOString(),
    deleted: m.deletedAt !== null,
    attachmentKind: m.deletedAt ? null : (kinds.find((k) => k.id === m.attachmentId)?.kind ?? null),
  });

  const general = rows.find((r) => r.taskId === null && r.dmKey === null);
  const channels: (ChatChannelDto & { at: number })[] = [
    {
      taskId: null,
      withPersonId: null,
      title: "צ'אט כללי",
      unread: unread.get('general') ?? 0,
      last: general ? last(general) : null,
      at: general?.id ?? Number.MAX_SAFE_INTEGER,
    },
  ];
  const dmOthers = rows.filter((r) => r.dmKey).map((r) => r.dmKey!.split(':').find((id) => id !== p.personId)!);
  const names = dmOthers.length
    ? await ctx.db.select({ id: people.id, name: people.displayName }).from(people).where(inArray(people.id, dmOthers))
    : [];
  for (const r of rows) {
    if (r.taskId) {
      const task = await loadTask(ctx.db, r.taskId);
      if (!task || task.deletedAt || !policy.canViewTask(p, task)) continue;
      channels.push({ taskId: task.id, withPersonId: null, title: task.title, unread: unread.get(`task:${task.id}`) ?? 0, last: last(r), at: r.id });
    } else if (r.dmKey) {
      const other = r.dmKey.split(':').find((id) => id !== p.personId)!;
      const name = names.find((n) => n.id === other)?.name ?? '—';
      channels.push({ taskId: null, withPersonId: other, title: name, unread: unread.get(`dm:${r.dmKey}`) ?? 0, last: last(r), at: r.id });
    }
  }
  return channels.sort((a, b) => b.at - a.at).map(({ at: _at, ...c }) => c);
}

/** Who may be tagged: people who can sign in and can see the channel. Private conversations have no tags. */
async function assertMentionable(db: Db, p: Principal, channel: Channel, mentionIds: string[]): Promise<void> {
  if (mentionIds.length === 0) return;
  if (channel.kind === 'dm') throw invalid('There is no tagging in a private conversation');
  const found = await db
    .select({ id: people.id, role: people.role })
    .from(people)
    .where(and(eq(people.orgId, p.orgId), inArray(people.id, mentionIds), isNull(people.deactivatedAt), sql`${people.role} is not null`));
  if (found.length !== mentionIds.length) throw invalid('Only people who sign in to the site can be tagged');
  if (channel.kind === 'task' && channel.task.visibility === 'private') {
    const task = channel.task;
    const insiders = new Set([task.ownerPersonId, ...task.participantIds, task.createdByPersonId]);
    const outsider = found.find((f) => f.role !== 'manager' && !insiders.has(f.id));
    if (outsider) throw invalid('A tagged person cannot see this private task');
  }
}

/** Checks an attached file and returns its decoded size. */
function checkAttachment(a: NonNullable<PostOutput['attachment']>): number {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(a.dataBase64)) throw invalid('The file could not be read');
  const size = Buffer.from(a.dataBase64, 'base64').length;
  if (size === 0) throw invalid('The file is empty');
  if (size > MAX_CHAT_FILE_BYTES) throw invalid('The file is too large (up to 3 MB)');
  if (a.kind === 'voice' && !a.mimeType.startsWith('audio/')) throw invalid('A voice message must be a recording');
  return size;
}

export async function postMessage(ctx: AppContext, p: Principal, input: PostMessageInput): Promise<MessageDto> {
  const channel = await openChannel(ctx.db, p, input);
  const mentionIds = [...new Set(input.mentionIds)];
  const size = input.attachment ? checkAttachment(input.attachment) : 0;
  return ctx.db.transaction(async (tx) => {
    await assertMentionable(tx, p, channel, mentionIds);
    let attachment: AttachmentRow | undefined;
    if (input.attachment) {
      const a = input.attachment;
      const [row] = await tx
        .insert(chatAttachments)
        .values({
          orgId: p.orgId,
          uploaderPersonId: p.personId,
          kind: a.kind,
          // Keep only the name, never a path.
          fileName: a.fileName.split(/[\\/]/).pop()!.slice(0, 200) || 'קובץ',
          mimeType: a.mimeType,
          sizeBytes: size,
          durationMs: a.kind === 'voice' ? a.durationMs : null,
          dataBase64: a.dataBase64,
          createdAt: ctx.now(),
        })
        .returning(attachmentColumns);
      attachment = row;
    }
    const [message] = await tx
      .insert(chatMessages)
      .values({
        orgId: p.orgId,
        taskId: channel.kind === 'task' ? channel.task.id : null,
        dmKey: channel.kind === 'dm' ? channel.key : null,
        authorPersonId: p.personId,
        body: input.body,
        attachmentId: attachment?.id ?? null,
        createdAt: ctx.now(),
      })
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
          taskId: message!.taskId,
          messageId: message!.id,
          createdAt: ctx.now(),
        })),
      );
    }
    // Sending a message means the sender has read the conversation up to it.
    await markReadIn(tx, p, channelKey(channel), message!.id, ctx.now());
    return toDto(message!, mentionIds, attachment, p);
  });
}

/** Authors delete their own messages; managers may delete any. The message stays as "deleted". */
export async function deleteMessage(ctx: AppContext, p: Principal, id: number): Promise<void> {
  const [m] = await ctx.db.select().from(chatMessages).where(eq(chatMessages.id, id));
  if (!m || m.orgId !== p.orgId) throw notFound('Message');
  await channelOfMessage(ctx.db, p, m);
  if (m.authorPersonId !== p.personId && !policy.isManager(p)) throw forbidden();
  if (m.deletedAt) return;
  await ctx.db.update(chatMessages).set({ deletedAt: ctx.now(), deletedByPersonId: p.personId }).where(eq(chatMessages.id, id));
}

/** A file or recording, for whoever may read the message it was sent in. */
export async function getAttachment(ctx: AppContext, p: Principal, id: number): Promise<{ fileName: string; mimeType: string; data: Buffer }> {
  const [m] = await ctx.db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.attachmentId, id), eq(chatMessages.orgId, p.orgId), isNull(chatMessages.deletedAt)));
  if (!m) throw notFound('File');
  await channelOfMessage(ctx.db, p, m);
  const [a] = await ctx.db.select().from(chatAttachments).where(eq(chatAttachments.id, id));
  if (!a) throw notFound('File');
  return { fileName: a.fileName, mimeType: a.mimeType, data: Buffer.from(a.dataBase64, 'base64') };
}

async function markReadIn(db: Db, p: Principal, key: string, lastId: number, now: Date): Promise<void> {
  await db
    .insert(chatReads)
    .values({ personId: p.personId, channelKey: key, orgId: p.orgId, lastReadId: lastId, updatedAt: now })
    .onConflictDoUpdate({
      target: [chatReads.personId, chatReads.channelKey],
      set: { lastReadId: sql`greatest(${chatReads.lastReadId}, ${lastId})`, updatedAt: now },
    });
}

/** Records that the caller has read a conversation up to a message (never moves backwards). */
export async function markChatRead(ctx: AppContext, p: Principal, input: z.output<typeof markChatReadSchema>): Promise<void> {
  const channel = await openChannel(ctx.db, p, input);
  await markReadIn(ctx.db, p, channelKey(channel), input.lastId, ctx.now());
}

/** How far everyone else in a conversation has read – the basis for ✓✓ on the caller's messages. */
export async function listReceipts(ctx: AppContext, p: Principal, q: z.output<typeof chatChannelQuerySchema>): Promise<ChatReceiptDto[]> {
  const channel = await openChannel(ctx.db, p, q);
  const rows = await ctx.db
    .select({ personId: chatReads.personId, lastReadId: chatReads.lastReadId })
    .from(chatReads)
    .where(and(eq(chatReads.orgId, p.orgId), eq(chatReads.channelKey, channelKey(channel)), ne(chatReads.personId, p.personId)));
  return rows;
}
