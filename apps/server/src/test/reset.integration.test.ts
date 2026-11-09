import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetContent } from '../modules/admin/reset-service';
import { listChannels, listMessages, postMessage } from '../modules/chat/chat-service';
import { listPeople } from '../modules/identity/people-service';
import { addFeedback, updateProfile } from '../modules/profiles/profile-service';
import { createTaskCategory } from '../modules/tasks/category-service';
import { createTask, listTasks } from '../modules/tasks/task-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe('starting over', () => {
  it('only a manager can do it, and only after typing the confirmation word', async () => {
    await expect(resetContent(h.ctx, h.member, 'מחיקה')).rejects.toMatchObject({ status: 403 });
    await expect(resetContent(h.ctx, h.manager, 'כן')).rejects.toMatchObject({ status: 400 });
  });

  it('deletes tasks, categories, profiles text, feedback and everyone else – but keeps the chat', async () => {
    const cat = await createTaskCategory(h.ctx, h.manager, { name: 'אירועים', color: '#2456c9' });
    const t = await createTask(h.ctx, h.manager, { title: 'למחיקה', description: '', ownerPersonId: h.member.personId, dueDate: null, participantIds: [h.guest.personId], categoryId: cat.id });
    await postMessage(h.ctx, h.manager, { taskId: t.id, mentionIds: [], body: 'על המשימה' });
    await postMessage(h.ctx, h.member, { taskId: null, mentionIds: [], body: 'בצ\'אט הכללי' });
    await postMessage(h.ctx, h.member, { taskId: null, withPersonId: h.manager.personId, mentionIds: [], body: 'פרטי' });
    await updateProfile(h.ctx, h.manager, h.manager.personId, { responsibilities: 'הכול' });
    await addFeedback(h.ctx, h.manager, h.member.personId, 'כל הכבוד');

    const result = await resetContent(h.ctx, h.manager, ' מחיקה ');
    expect(result).toMatchObject({ tasks: 1, categories: 1, feedback: 1, people: 4 });

    expect(await listTasks(h.ctx, h.manager, { view: 'all', mine: false, includeArchived: true } as never)).toEqual([]);
    const people = await listPeople(h.ctx, h.manager);
    expect(people.map((p) => p.id)).toEqual([h.manager.personId]);
    expect(people[0]?.responsibilities ?? '').toBe('');

    // The chat stays: general and private conversations, with the removed person's messages.
    expect((await listMessages(h.ctx, h.manager, { limit: 50 })).map((m) => m.body)).toContain('בצ\'אט הכללי');
    expect((await listMessages(h.ctx, h.manager, { withPersonId: h.member.personId, limit: 50 })).map((m) => m.body)).toContain('פרטי');
    expect((await listChannels(h.ctx, h.manager)).some((c) => c.taskId !== null)).toBe(false);
  });
});

describe('after someone is removed', () => {
  it('your private conversation with them stays readable, but takes no new messages', async () => {
    await expect(
      postMessage(h.ctx, h.manager, { taskId: null, withPersonId: h.member.personId, mentionIds: [], body: 'עוד אחת' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
