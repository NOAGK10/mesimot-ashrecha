import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteMessage, listMessages, postMessage } from '../modules/chat/chat-service';
import { listInbox, markRead, unreadCount } from '../modules/inbox/inbox-service';
import { createTask, setParticipants } from '../modules/tasks/task-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const general = { taskId: null, mentionIds: [] as string[] };
const list = (p = h.manager, extra: { taskId?: string; after?: number; before?: number } = {}) =>
  listMessages(h.ctx, p, { limit: 50, ...extra });

describe('general chat', () => {
  it('is shared by everyone who signs in, including guests', async () => {
    await postMessage(h.ctx, h.manager, { ...general, body: 'בוקר טוב לכולם' });
    await postMessage(h.ctx, h.guest, { ...general, body: 'בוקר טוב!' });
    expect((await list(h.member)).map((m) => m.body)).toEqual(['בוקר טוב לכולם', 'בוקר טוב!']);
  });

  it('is closed to magic-link visitors', async () => {
    const link = h.principal(h.contactId, 'link', '00000000-0000-4000-8000-000000000000');
    await expect(list(link)).rejects.toMatchObject({ status: 403 });
  });

  it('supports polling for new messages and loading older ones', async () => {
    const all = await list();
    const last = all.at(-1)!;
    const fresh = await postMessage(h.ctx, h.partner, { ...general, body: 'הודעה חדשה' });
    expect((await list(h.manager, { after: last.id })).map((m) => m.id)).toEqual([fresh.id]);
    expect((await list(h.manager, { before: fresh.id })).map((m) => m.id)).toEqual(all.map((m) => m.id));
  });

  it('tagging someone puts a notification on their home page, never on the author\'s', async () => {
    const before = await unreadCount(h.ctx, h.member);
    const m = await postMessage(h.ctx, h.manager, { ...general, body: '@Member תבדוק בבקשה את ההצעה', mentionIds: [h.member.personId, h.manager.personId] });
    expect(m.mentionIds.sort()).toEqual([h.member.personId, h.manager.personId].sort());
    expect(await unreadCount(h.ctx, h.member)).toBe(before + 1);
    const [item] = await listInbox(h.ctx, h.member);
    expect(item).toMatchObject({ kind: 'mention', actorPersonId: h.manager.personId, messageId: m.id, taskId: null, read: false });
    expect(item!.excerpt).toContain('תבדוק בבקשה');
    expect((await listInbox(h.ctx, h.manager)).some((i) => i.messageId === m.id)).toBe(false);

    await markRead(h.ctx, h.member, { ids: [item!.id] });
    expect(await unreadCount(h.ctx, h.member)).toBe(before);
  });

  it('cannot tag contacts who never sign in', async () => {
    await expect(postMessage(h.ctx, h.manager, { ...general, body: 'x', mentionIds: [h.contactId] })).rejects.toMatchObject({ status: 400 });
  });

  it('authors and managers may delete; the message stays as "deleted"', async () => {
    const m = await postMessage(h.ctx, h.member, { ...general, body: 'טעות' });
    await expect(deleteMessage(h.ctx, h.guest, m.id)).rejects.toMatchObject({ status: 403 });
    await deleteMessage(h.ctx, h.member, m.id);
    const shown = (await list()).find((x) => x.id === m.id)!;
    expect(shown).toMatchObject({ deleted: true, body: '', canDelete: false });
    const other = await postMessage(h.ctx, h.member, { ...general, body: 'עוד אחת' });
    await deleteMessage(h.ctx, h.manager, other.id);
  });
});

describe('task chat', () => {
  it('follows the task\'s visibility, and guests can be tagged only if they are on the task', async () => {
    const t = await createTask(h.ctx, h.manager, { title: 'Chat task', description: '', ownerPersonId: h.member.personId, dueDate: null, participantIds: [] });
    await postMessage(h.ctx, h.member, { taskId: t.id, mentionIds: [], body: 'התחלתי' });
    expect((await list(h.manager, { taskId: t.id })).map((m) => m.body)).toEqual(['התחלתי']);
    expect((await list()).some((m) => m.body === 'התחלתי')).toBe(false);

    await expect(list(h.guest, { taskId: t.id })).rejects.toMatchObject({ status: 404 });
    await expect(postMessage(h.ctx, h.manager, { taskId: t.id, mentionIds: [h.guest.personId], body: 'x' })).rejects.toMatchObject({ status: 400 });

    const withGuest = await setParticipants(h.ctx, h.manager, t.id, { version: t.version, participantIds: [h.guest.personId] });
    expect(withGuest.participantIds).toEqual([h.guest.personId]);
    await postMessage(h.ctx, h.manager, { taskId: t.id, mentionIds: [h.guest.personId], body: '@Guest מה המצב?' });
    const item = (await listInbox(h.ctx, h.guest)).find((i) => i.kind === 'mention');
    expect(item).toMatchObject({ taskId: t.id, taskTitle: 'Chat task' });
  });
});

describe('assignment notifications on the home page', () => {
  it('people who sign in get a "task assigned" item; contacts and the assigner do not', async () => {
    const t = await createTask(h.ctx, h.manager, {
      title: 'Assigned to partner',
      description: '',
      ownerPersonId: h.partner.personId,
      dueDate: null,
      participantIds: [h.contactId, h.manager.personId],
    });
    expect((await listInbox(h.ctx, h.partner)).find((i) => i.taskId === t.id)).toMatchObject({ kind: 'task_assigned', actorPersonId: h.manager.personId });
    expect((await listInbox(h.ctx, h.manager)).some((i) => i.taskId === t.id)).toBe(false);
    expect((await listInbox(h.ctx, h.principal(h.contactId))).some((i) => i.taskId === t.id)).toBe(false);
    await markRead(h.ctx, h.partner, { all: true });
    expect(await unreadCount(h.ctx, h.partner)).toBe(0);
  });
});
