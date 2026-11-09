import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listInbox } from '../modules/inbox/inbox-service';
import { dispatchDueNotifications } from '../modules/notifications/dispatcher';
import { createTask, getTaskDetail, updateTask } from '../modules/tasks/task-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const base = { participantIds: [] as string[], dueDate: null };

describe('tagging people with "@" in a task', () => {
  it('notifies whoever is tagged – on the home page and by e-mail', async () => {
    const t = await createTask(h.ctx, h.manager, { ...base, title: 'הזמנת אולם', description: '@Member תבדוק מחירים', ownerPersonId: h.manager.personId, mentionIds: [h.member.personId] });
    const item = (await listInbox(h.ctx, h.member)).find((i) => i.taskId === t.id)!;
    expect(item).toMatchObject({ kind: 'mention', actorPersonId: h.manager.personId, messageId: null, excerpt: '@Member תבדוק מחירים', taskTitle: 'הזמנת אולם' });

    const before = h.mailer.sent.length;
    await dispatchDueNotifications(h.ctx);
    const mail = h.mailer.sent.slice(before).find((m) => m.to === 'member@example.org')!;
    expect(mail.subject).toContain('תייג אותך במשימה „הזמנת אולם”');
    expect(mail.text).toContain(`/tasks/${t.id}`);
    expect(mail.text).toContain('לפתיחת המשימה');
  });

  it('tagging someone in a private task lets them see it', async () => {
    const t = await createTask(h.ctx, h.manager, { ...base, title: 'פרטי', description: '', ownerPersonId: h.manager.personId, visibility: 'private' });
    await expect(getTaskDetail(h.ctx, h.member, t.id)).rejects.toMatchObject({ status: 404 });
    const edited = await updateTask(h.ctx, h.manager, t.id, { version: t.version, description: '@Member שים לב', mentionIds: [h.member.personId] });
    expect(edited.participantIds).toContain(h.member.personId);
    expect((await getTaskDetail(h.ctx, h.member, t.id)).title).toBe('פרטי');
    expect((await listInbox(h.ctx, h.member)).some((i) => i.taskId === t.id && i.kind === 'mention')).toBe(true);
  });

  it('only people who sign in can be tagged', async () => {
    await expect(
      createTask(h.ctx, h.manager, { ...base, title: 'x', description: '', ownerPersonId: h.manager.personId, mentionIds: [h.contactId] }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
