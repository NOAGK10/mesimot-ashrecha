import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteMessage, getAttachment, listChannels, listMessages, listReceipts, markChatRead, postMessage } from '../modules/chat/chat-service';
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
    const t = await createTask(h.ctx, h.manager, { title: 'Chat task', description: '', ownerPersonId: h.member.personId, dueDate: null, participantIds: [], visibility: 'private' });
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

describe('organisation task chat', () => {
  it('is open to everyone who signs in, so guests can read it and be tagged', async () => {
    const t = await createTask(h.ctx, h.manager, { title: 'Org chat task', description: '', ownerPersonId: h.member.personId, dueDate: null, participantIds: [] });
    await postMessage(h.ctx, h.manager, { taskId: t.id, mentionIds: [h.guest.personId], body: 'גם לך' });
    expect((await list(h.guest, { taskId: t.id })).map((m) => m.body)).toEqual(['גם לך']);
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

describe('conversation list', () => {
  it('lists the general chat and task conversations, newest first, hiding private tasks from outsiders', async () => {
    const open = await createTask(h.ctx, h.manager, { title: 'שיחה פתוחה', description: '', ownerPersonId: h.member.personId, dueDate: null, participantIds: [] });
    const secret = await createTask(h.ctx, h.manager, { title: 'שיחה סודית', description: '', ownerPersonId: h.manager.personId, dueDate: null, participantIds: [], visibility: 'private' });
    await postMessage(h.ctx, h.manager, { taskId: open.id, mentionIds: [], body: 'על המשימה' });
    await postMessage(h.ctx, h.manager, { taskId: secret.id, mentionIds: [], body: 'סוד' });

    const forManager = await listChannels(h.ctx, h.manager);
    expect(forManager[0]).toMatchObject({ taskId: secret.id, title: 'שיחה סודית', last: { body: 'סוד', authorPersonId: h.manager.personId } });
    expect(forManager.map((c) => c.taskId)).toEqual(expect.arrayContaining([null, open.id, secret.id]));

    const forGuest = await listChannels(h.ctx, h.guest);
    expect(forGuest.map((c) => c.taskId)).toContain(open.id);
    expect(forGuest.map((c) => c.taskId)).not.toContain(secret.id);
    expect(forGuest.find((c) => c.taskId === null)?.title).toBe("צ'אט כללי");
  });
});

describe('private conversations', () => {
  it('are seen only by the two people – not by others, not even managers', async () => {
    const m = await postMessage(h.ctx, h.member, { taskId: null, withPersonId: h.guest.personId, mentionIds: [], body: 'רק בינינו' });
    expect(m.dmPersonIds?.slice().sort()).toEqual([h.member.personId, h.guest.personId].sort());
    expect((await listMessages(h.ctx, h.guest, { withPersonId: h.member.personId, limit: 50 })).map((x) => x.body)).toContain('רק בינינו');
    // The manager has a conversation of their own with the member – a different one.
    expect((await listMessages(h.ctx, h.manager, { withPersonId: h.member.personId, limit: 50 })).map((x) => x.body)).not.toContain('רק בינינו');
    // Never in the general chat.
    expect((await list(h.manager)).map((x) => x.body)).not.toContain('רק בינינו');
    // Others cannot open its file or delete it.
    await expect(deleteMessage(h.ctx, h.manager, m.id)).rejects.toMatchObject({ status: 404 });

    const forGuest = await listChannels(h.ctx, h.guest);
    expect(forGuest.find((c) => c.withPersonId === h.member.personId)).toMatchObject({ title: 'Member', unread: 1 });
    expect((await listChannels(h.ctx, h.manager)).some((c) => c.withPersonId === h.guest.personId || c.withPersonId === h.member.personId && c.last?.body === 'רק בינינו')).toBe(false);
  });

  it('cannot be opened with yourself, with contacts who never sign in, or with tags', async () => {
    await expect(postMessage(h.ctx, h.member, { taskId: null, withPersonId: h.member.personId, mentionIds: [], body: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(postMessage(h.ctx, h.member, { taskId: null, withPersonId: h.contactId, mentionIds: [], body: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(
      postMessage(h.ctx, h.member, { taskId: null, withPersonId: h.guest.personId, mentionIds: [h.guest.personId], body: 'x' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('read receipts', () => {
  it('track how far the other person has read, and clear the unread count', async () => {
    const m = await postMessage(h.ctx, h.partner, { taskId: null, withPersonId: h.member.personId, mentionIds: [], body: 'ראית?' });
    expect(await listReceipts(h.ctx, h.partner, { withPersonId: h.member.personId })).toEqual([]);
    expect((await listChannels(h.ctx, h.member)).find((c) => c.withPersonId === h.partner.personId)?.unread).toBe(1);

    await markChatRead(h.ctx, h.member, { taskId: null, withPersonId: h.partner.personId, lastId: m.id });
    expect(await listReceipts(h.ctx, h.partner, { withPersonId: h.member.personId })).toEqual([{ personId: h.member.personId, lastReadId: m.id }]);
    expect((await listChannels(h.ctx, h.member)).find((c) => c.withPersonId === h.partner.personId)?.unread).toBe(0);
    // Never moves backwards.
    await markChatRead(h.ctx, h.member, { taskId: null, withPersonId: h.partner.personId, lastId: 1 });
    expect((await listReceipts(h.ctx, h.partner, { withPersonId: h.member.personId }))[0]?.lastReadId).toBe(m.id);
  });
});

describe('files and voice messages', () => {
  const pdf = Buffer.from('%PDF-1.4 test').toString('base64');

  it('are stored with the message and served only to people in the conversation', async () => {
    const m = await postMessage(h.ctx, h.member, {
      taskId: null,
      withPersonId: h.partner.personId,
      mentionIds: [],
      body: '',
      attachment: { kind: 'file', fileName: '../../secret/הצעה.pdf', mimeType: 'application/pdf', dataBase64: pdf, durationMs: null },
    });
    expect(m.attachment).toMatchObject({ kind: 'file', fileName: 'הצעה.pdf', mimeType: 'application/pdf', sizeBytes: 13 });
    const file = await getAttachment(h.ctx, h.partner, m.attachment!.id);
    expect(file.data.toString()).toBe('%PDF-1.4 test');
    await expect(getAttachment(h.ctx, h.manager, m.attachment!.id)).rejects.toMatchObject({ status: 404 });

    // A deleted message takes its file with it.
    await deleteMessage(h.ctx, h.member, m.id);
    await expect(getAttachment(h.ctx, h.partner, m.attachment!.id)).rejects.toMatchObject({ status: 404 });
  });

  it('voice messages keep their length and must be audio', async () => {
    const audio = Buffer.from('fake-opus-data').toString('base64');
    const v = await postMessage(h.ctx, h.member, {
      taskId: null,
      mentionIds: [],
      body: '',
      attachment: { kind: 'voice', fileName: 'הקלטה.webm', mimeType: 'audio/webm;codecs=opus', dataBase64: audio, durationMs: 4200 },
    });
    expect(v.attachment).toMatchObject({ kind: 'voice', durationMs: 4200 });
    expect((await listChannels(h.ctx, h.manager)).find((c) => c.taskId === null && c.withPersonId === null)?.last?.attachmentKind).toBe('voice');
    await expect(
      postMessage(h.ctx, h.member, {
        taskId: null,
        mentionIds: [],
        body: '',
        attachment: { kind: 'voice', fileName: 'x.exe', mimeType: 'application/x-msdownload', dataBase64: audio, durationMs: 1 },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
