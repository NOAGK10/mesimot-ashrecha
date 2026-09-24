import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { notifications } from '../db/schema';
import { dispatchDueNotifications } from '../modules/notifications/dispatcher';
import { runWorkerTick } from '../worker';
import { createHarness, type Harness } from './harness';

let h: Harness;
let app: FastifyInstance;
beforeAll(async () => {
  h = await createHarness();
  app = await h.buildApp();
});
afterAll(async () => {
  await app.close();
  await h.close();
});

const JSON_HEADERS = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

async function login(email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/dev-login', headers: JSON_HEADERS, payload: { email } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'om_session')!;
  expect(cookie.httpOnly).toBe(true);
  return `om_session=${cookie.value}`;
}

describe('HTTP API', () => {
  it('requires authentication and the CSRF header', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/tasks' })).statusCode).toBe(401);
    const cookie = await login('boss@example.org');
    const noHeader = await app.inject({ method: 'POST', url: '/api/tasks', headers: { cookie, 'content-type': 'application/json' }, payload: {} });
    expect(noHeader.statusCode).toBe(403);
    expect(noHeader.json().error.code).toBe('csrf');
  });

  it('does not let contacts without a login role sign in', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/dev-login', headers: JSON_HEADERS, payload: { email: 'contact@example.org' } });
    expect(res.statusCode).toBe(403);
  });

  it('Google sign-in links the account to an invited person only', async () => {
    const ok = await app.inject({ method: 'POST', url: '/api/auth/google', headers: JSON_HEADERS, payload: { credential: 'google:partner@example.org' } });
    expect(ok.statusCode).toBe(200);
    const stranger = await app.inject({ method: 'POST', url: '/api/auth/google', headers: JSON_HEADERS, payload: { credential: 'google:nobody@example.org' } });
    expect(stranger.statusCode).toBe(403);
  });

  it('validates input and reports structured errors', async () => {
    const cookie = await login('boss@example.org');
    const res = await app.inject({ method: 'POST', url: '/api/tasks', headers: { ...JSON_HEADERS, cookie }, payload: { title: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid');
  });

  it('full flow: manager assigns a contact → e-mail with magic link → scoped access → status update', async () => {
    const cookie = await login('boss@example.org');
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { ...JSON_HEADERS, cookie },
      payload: { title: 'Collect invoices', ownerPersonId: h.contactId, dueDate: '2026-10-06' },
    });
    expect(created.statusCode).toBe(201);
    const task = created.json();

    await runWorkerTick(h.ctx);
    const mail = h.mailer.sent.find((m) => m.to === 'contact@example.org' && m.subject.includes('Collect invoices'))!;
    expect(mail).toBeDefined();
    const link = /http:\/\/app\.test(\/api\/auth\/magic\?token=[^\s]+)/.exec(mail.text)![1]!;

    const redeemed = await app.inject({ method: 'GET', url: link });
    expect(redeemed.statusCode).toBe(302);
    expect(redeemed.headers.location).toBe(`http://app.test/tasks/${task.id}`);
    const linkCookie = `om_session=${redeemed.cookies.find((c) => c.name === 'om_session')!.value}`;

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: linkCookie } });
    expect(me.json()).toMatchObject({ access: 'link', scopeTaskId: task.id });
    expect((await app.inject({ method: 'GET', url: '/api/tasks', headers: { cookie: linkCookie } })).statusCode).toBe(403);

    const detail = await app.inject({ method: 'GET', url: `/api/tasks/${task.id}`, headers: { cookie: linkCookie } });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().canEdit).toBe(false);

    const status = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/status`,
      headers: { ...JSON_HEADERS, cookie: linkCookie },
      payload: { version: task.version, status: 'completed' },
    });
    expect(status.statusCode).toBe(200);
    const events = (await app.inject({ method: 'GET', url: `/api/tasks/${task.id}`, headers: { cookie } })).json().events;
    expect(events.at(-1)).toMatchObject({ type: 'task.status_changed', actorPersonId: h.contactId });

    // Once removed from the task, the link stops working.
    await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      headers: { ...JSON_HEADERS, cookie },
      payload: { version: status.json().version, ownerPersonId: h.manager.personId },
    });
    const again = await app.inject({ method: 'GET', url: link });
    expect(again.headers.location).toBe('http://app.test/link-expired');
  });

  it('delivers due reminders once and cancels irrelevant ones', async () => {
    const cookie = await login('boss@example.org');
    const created = (
      await app.inject({ method: 'POST', url: '/api/tasks', headers: { ...JSON_HEADERS, cookie }, payload: { title: 'Reminder test', ownerPersonId: h.partner.personId, dueDate: '2026-10-05' } })
    ).json();
    // Created at T0 (4 Oct 09:00), exactly when "due soon" would fire, so it is not planned.
    // At 5 Oct 09:00 the assignment notice and "due today" are due; "overdue" waits for 6 Oct.
    h.clock.now = new Date('2026-10-05T06:00:00Z');
    const before = h.mailer.sent.length;
    await dispatchDueNotifications(h.ctx);
    await dispatchDueNotifications(h.ctx);
    const subjects = h.mailer.sent.slice(0, h.mailer.sent.length - before).map((m) => m.subject);
    expect(subjects.filter((s) => s.includes('Reminder test')).sort()).toEqual(['היום: Reminder test', 'משימה חדשה עבורך: Reminder test']);

    const rows = await h.ctx.db.select().from(notifications).where(eq(notifications.taskId, created.id));
    expect(rows.filter((r) => r.status === 'sent')).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'pending').map((r) => r.kind)).toEqual(['overdue']);
    h.clock.now = new Date('2026-10-04T06:00:00Z');
  });

  it('exposes worker status to managers only', async () => {
    const boss = await login('boss@example.org');
    const res = await app.inject({ method: 'GET', url: '/api/ops/status', headers: { cookie: boss } });
    expect(res.statusCode).toBe(200);
    expect(res.json().worker.lastBeatAt).not.toBeNull();
    const guest = await login('guest@example.org');
    expect((await app.inject({ method: 'GET', url: '/api/ops/status', headers: { cookie: guest } })).statusCode).toBe(403);
  });

  it('health endpoints', async () => {
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(200);
  });
});
