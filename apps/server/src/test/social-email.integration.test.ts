import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteMessage, postMessage } from '../modules/chat/chat-service';
import { dispatchDueNotifications } from '../modules/notifications/dispatcher';
import { buildSocialEmail } from '../modules/notifications/email-content';
import { addFeedback } from '../modules/profiles/profile-service';
import { createTask } from '../modules/tasks/task-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const mailsTo = (email: string) => h.mailer.sent.filter((m) => m.to === email);

describe('e-mails for tags and feedback', () => {
  it('a tag in the general chat is e-mailed with the message and a link to it', async () => {
    const m = await postMessage(h.ctx, h.manager, { taskId: null, mentionIds: [h.member.personId], body: '@Member תעבור על ההצעה בבקשה' });
    await dispatchDueNotifications(h.ctx);
    const mail = mailsTo('member@example.org').find((x) => x.text.includes('תעבור על ההצעה'))!;
    expect(mail.subject).toBe("Test Org · boss תייג אותך בצ'אט הכללי");
    expect(mail.text).toContain(`http://app.test/chat#m${m.id}`);
  });

  it('a tag in a task chat names the task and links to it', async () => {
    const t = await createTask(h.ctx, h.manager, { title: 'להזמין אולם', description: '', ownerPersonId: h.member.personId, dueDate: null, participantIds: [] });
    const m = await postMessage(h.ctx, h.member, { taskId: t.id, mentionIds: [h.manager.personId], body: 'צריך אישור תקציב' });
    await dispatchDueNotifications(h.ctx);
    const mail = mailsTo('boss@example.org').find((x) => x.text.includes('צריך אישור תקציב'))!;
    expect(mail.subject).toBe('Test Org · Member תייג אותך במשימה „להזמין אולם”');
    expect(mail.text).toContain(`http://app.test/tasks/${t.id}#m${m.id}`);
  });

  it('feedback is e-mailed to the person it is about', async () => {
    await addFeedback(h.ctx, h.guest, h.member.personId, 'כל הכבוד על הארגון!');
    await dispatchDueNotifications(h.ctx);
    const mail = mailsTo('member@example.org').find((x) => x.text.includes('כל הכבוד על הארגון'))!;
    expect(mail.subject).toBe('Test Org · Guest כתב לך פידבק');
    expect(mail.text).toContain(`http://app.test/people/${h.member.personId}#feedback`);
  });

  it('no e-mail goes out for a message deleted before sending', async () => {
    const before = mailsTo('member@example.org').length;
    const m = await postMessage(h.ctx, h.manager, { taskId: null, mentionIds: [h.member.personId], body: 'טעות, למחוק' });
    await deleteMessage(h.ctx, h.manager, m.id);
    await dispatchDueNotifications(h.ctx);
    expect(mailsTo('member@example.org')).toHaveLength(before);
  });

  it('escapes the quoted text in the HTML version', () => {
    const mail = buildSocialEmail({
      kind: 'feedback',
      orgName: 'אשריך',
      to: { name: 'דנה', email: 'd@example.org' },
      actorName: 'יוסי',
      taskTitle: null,
      body: '<img src=x onerror=alert(1)>',
      url: 'https://x.example',
    });
    expect(mail.html).not.toContain('<img');
  });
});
