import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tasks } from '../db/schema';
import { listInbox } from '../modules/inbox/inbox-service';
import { addFeedback, deleteFeedback, getAvatar, getProfile, performanceScore, setAvatar, updateProfile } from '../modules/profiles/profile-service';
import { changeStatus, createTask } from '../modules/tasks/task-service';
import { T0, createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('profiles', () => {
  it('everyone gets a default colour; people edit their own profile, managers anyone\'s', async () => {
    const profile = await getProfile(h.ctx, h.guest, h.member.personId);
    expect(profile.person.avatarColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(profile.canEditProfile).toBe(false);

    await updateProfile(h.ctx, h.member, h.member.personId, { avatarColor: '#123456', responsibilities: 'רכש, ספקים, הצעות מחיר' });
    const after = await getProfile(h.ctx, h.guest, h.member.personId);
    expect(after.person).toMatchObject({ avatarColor: '#123456', responsibilities: 'רכש, ספקים, הצעות מחיר' });

    await expect(updateProfile(h.ctx, h.guest, h.member.personId, { avatarColor: '#000000' })).rejects.toMatchObject({ status: 403 });
    await updateProfile(h.ctx, h.manager, h.member.personId, { responsibilities: null });
    expect((await getProfile(h.ctx, h.manager, h.member.personId)).person.responsibilities).toBeNull();
  });

  it('accepts a real image as a photo and rejects anything else', async () => {
    await setAvatar(h.ctx, h.member, h.member.personId, PNG_1x1);
    const avatar = await getAvatar(h.ctx, h.guest, h.member.personId);
    expect(avatar.mimeType).toBe('image/png');
    expect((await getProfile(h.ctx, h.guest, h.member.personId)).person.avatarVersion).not.toBeNull();

    const notAnImage = `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`;
    await expect(setAvatar(h.ctx, h.member, h.member.personId, notAnImage)).rejects.toMatchObject({ status: 400 });
    await expect(setAvatar(h.ctx, h.member, h.member.personId, 'data:image/svg+xml;base64,PHN2Zz4=')).rejects.toMatchObject({ status: 400 });
    await expect(setAvatar(h.ctx, h.guest, h.member.personId, PNG_1x1)).rejects.toMatchObject({ status: 403 });
  });

  it('profiles are not available through magic links', async () => {
    const link = h.principal(h.contactId, 'link', '00000000-0000-4000-8000-000000000000');
    await expect(getProfile(h.ctx, link, h.member.personId)).rejects.toMatchObject({ status: 403 });
  });
});

describe('feedback', () => {
  it('anyone signed in can give signed feedback to someone else; it notifies them and everyone can see it', async () => {
    const f = await addFeedback(h.ctx, h.guest, h.member.personId, 'תודה על הסידור של הספקים!');
    const seen = await getProfile(h.ctx, h.member, h.member.personId); // the subject, not a manager
    expect(seen.feedback[0]).toMatchObject({ id: f.id, authorPersonId: h.guest.personId, body: 'תודה על הסידור של הספקים!', canDelete: false });
    expect((await listInbox(h.ctx, h.member))[0]).toMatchObject({ kind: 'feedback', actorPersonId: h.guest.personId, excerpt: 'תודה על הסידור של הספקים!' });
  });

  it('cannot be given to yourself or to contacts who never sign in', async () => {
    await expect(addFeedback(h.ctx, h.member, h.member.personId, 'אני מעולה')).rejects.toMatchObject({ status: 400 });
    await expect(addFeedback(h.ctx, h.member, h.contactId, 'x')).rejects.toMatchObject({ status: 400 });
    expect((await getProfile(h.ctx, h.member, h.member.personId)).canGiveFeedback).toBe(false);
  });

  it('authors withdraw their own feedback; managers can remove any; others cannot', async () => {
    const f = await addFeedback(h.ctx, h.partner, h.member.personId, 'למחיקה');
    await expect(deleteFeedback(h.ctx, h.guest, f.id)).rejects.toMatchObject({ status: 403 });
    await deleteFeedback(h.ctx, h.manager, f.id);
    expect((await getProfile(h.ctx, h.member, h.member.personId)).feedback.some((x) => x.id === f.id)).toBe(false);
  });
});

describe('automatic score', () => {
  it('is the share of own tasks done by the due date, counting open overdue tasks as late', async () => {
    const owner = h.partner;
    const mk = async (title: string, dueDate: string | null) =>
      createTask(h.ctx, h.manager, { title, description: '', ownerPersonId: owner.personId, dueDate, participantIds: [] });

    // Not enough data yet.
    expect((await performanceScore(h.ctx, h.orgId, owner.personId)).value).toBeNull();

    // T0 = 4 Oct 2026. Completed today: two on time (due 4th and 10th), one late (due 1st).
    for (const [title, due] of [['on-time-1', '2026-10-04'], ['on-time-2', '2026-10-10'], ['late', '2026-10-01']] as const) {
      const t = await mk(title, due);
      await changeStatus(h.ctx, h.manager, t.id, { version: t.version, status: 'completed' });
    }
    const noDue = await mk('no-due', null);
    await changeStatus(h.ctx, h.manager, noDue.id, { version: noDue.version, status: 'completed' });
    await mk('open-overdue', '2026-09-30');
    await mk('open-future', '2026-11-01');

    const score = await performanceScore(h.ctx, h.orgId, owner.personId);
    expect(score).toMatchObject({ completedOnTime: 2, completedLate: 1, openOverdue: 1, completedWithoutDueDate: 1, value: 50 });
  });

  it('only looks at the last 180 days', async () => {
    const t = await createTask(h.ctx, h.manager, { title: 'old', description: '', ownerPersonId: h.guest.personId, dueDate: '2026-01-01', participantIds: [] });
    await changeStatus(h.ctx, h.manager, t.id, { version: t.version, status: 'completed' });
    await h.ctx.db.update(tasks).set({ completedAt: new Date(T0.getTime() - 200 * 86_400_000) }).where(eq(tasks.id, t.id));
    expect((await performanceScore(h.ctx, h.orgId, h.guest.personId)).completedLate).toBe(0);
  });
});
