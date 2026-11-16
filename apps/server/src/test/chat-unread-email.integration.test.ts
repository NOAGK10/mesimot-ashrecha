import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { markChatRead, postMessage, UNREAD_EMAIL_DELAY_MINUTES } from '../modules/chat/chat-service';
import { dispatchDueNotifications } from '../modules/notifications/dispatcher';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const unreadMailsTo = (email: string) => h.mailer.sent.filter((m) => m.to === email && m.subject.includes('שלא קראת'));
const later = (minutes: number) => {
  h.clock.now = new Date(h.clock.now.getTime() + minutes * 60_000);
};

describe('e-mail for private messages that were not read', () => {
  it('waits, then sends one e-mail with all the unread messages', async () => {
    await postMessage(h.ctx, h.manager, { taskId: null, withPersonId: h.member.personId, mentionIds: [], body: 'שלום, יש לך דקה?' });
    await postMessage(h.ctx, h.manager, { taskId: null, withPersonId: h.member.personId, mentionIds: [], body: 'צריך את רשימת הספקים' });
    await dispatchDueNotifications(h.ctx);
    expect(unreadMailsTo('member@example.org')).toHaveLength(0); // not yet – maybe they read it soon

    later(UNREAD_EMAIL_DELAY_MINUTES + 1);
    await dispatchDueNotifications(h.ctx);
    const mails = unreadMailsTo('member@example.org');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe('Test Org · 2 הודעות שלא קראת מboss');
    expect(mails[0]!.text).toContain('צריך את רשימת הספקים');
    expect(mails[0]!.text).toContain(`http://app.test/chat?with=${h.manager.personId}`);
  });

  it('sends nothing when the message was read in time', async () => {
    const m = await postMessage(h.ctx, h.member, { taskId: null, withPersonId: h.partner.personId, mentionIds: [], body: 'קיבלתי, תודה' });
    await markChatRead(h.ctx, h.partner, { taskId: null, withPersonId: h.member.personId, lastId: m.id });
    later(UNREAD_EMAIL_DELAY_MINUTES + 1);
    await dispatchDueNotifications(h.ctx);
    expect(unreadMailsTo('partner@example.org')).toHaveLength(0);
  });

  it('the general chat does not send these e-mails', async () => {
    const before = h.mailer.sent.length;
    await postMessage(h.ctx, h.manager, { taskId: null, mentionIds: [], body: 'בוקר טוב לכולם' });
    later(UNREAD_EMAIL_DELAY_MINUTES + 1);
    await dispatchDueNotifications(h.ctx);
    expect(h.mailer.sent.length).toBe(before);
  });
});
