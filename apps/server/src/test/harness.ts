import { pino } from 'pino';
import { eq } from 'drizzle-orm';
import { buildApp } from '../app';
import { loadConfig } from '../config';
import type { AppContext } from '../context';
import { openDatabase } from '../db/client';
import { people } from '../db/schema';
import type { Principal } from '../modules/identity/principal';
import { ConsoleMailer } from '../modules/notifications/mailer';
import { createPerson } from '../modules/identity/people-service';
import { bootstrapOrganization } from '../seed';

/** Sunday 4 Oct 2026, 09:00 in Asia/Jerusalem (UTC+3). */
export const T0 = new Date('2026-10-04T06:00:00Z');

/** Real PostgreSQL (PGlite, in memory) with migrations applied, a controllable clock and a capturing mailer. */
export async function createHarness() {
  const database = await openDatabase('pglite:memory');
  await database.migrate();
  const clock = { now: T0 };
  const mailer = new ConsoleMailer();
  const ctx: AppContext = {
    db: database.db,
    config: loadConfig({ NODE_ENV: 'test', AUTH_DEV_LOGIN: 'true', APP_URL: 'http://app.test' }),
    mailer,
    google: {
      verify: async (credential) => (credential.startsWith('google:') ? { sub: `sub-${credential}`, email: credential.slice(7) } : null),
    },
    log: pino({ level: 'silent' }),
    now: () => clock.now,
  };
  const orgId = await bootstrapOrganization(ctx, 'Test Org', ['boss@example.org', 'partner@example.org']);
  const [boss] = await ctx.db.select().from(people).where(eq(people.email, 'boss@example.org'));
  const [partner] = await ctx.db.select().from(people).where(eq(people.email, 'partner@example.org'));

  const principal = (personId: string, access: Principal['access'] = 'manager', scopeTaskId: string | null = null): Principal => ({
    personId,
    orgId,
    access,
    scopeTaskId,
    via: access === 'link' ? 'magic_link' : 'session',
  });
  const manager = principal(boss!.id);
  const guestPerson = await createPerson(ctx, manager, { displayName: 'Guest', email: 'guest@example.org', role: 'guest' });
  const contactPerson = await createPerson(ctx, manager, { displayName: 'Contact', email: 'contact@example.org', role: null });

  return {
    ctx,
    database,
    clock,
    mailer,
    orgId,
    manager,
    partner: principal(partner!.id),
    guest: principal(guestPerson.id, 'guest'),
    contactId: contactPerson.id,
    principal,
    buildApp: () => buildApp(ctx, { ping: database.ping }),
    close: () => database.close(),
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
