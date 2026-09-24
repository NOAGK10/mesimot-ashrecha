import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import type { SourceTable } from '@org/shared';
import { SecretBox } from '../lib/secret-box';
import { DRIVE_FILE_SCOPE, type GoogleFileMeta, type GoogleWorkspace } from '../modules/google/gateway';
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
  const fakeDrive = createFakeDrive();
  const ctx: AppContext = {
    db: database.db,
    config: loadConfig({ NODE_ENV: 'test', AUTH_DEV_LOGIN: 'true', APP_URL: 'http://app.test' }),
    mailer,
    google: {
      verify: async (credential) => (credential.startsWith('google:') ? { sub: `sub-${credential}`, email: credential.slice(7) } : null),
    },
    googleWorkspace: { api: fakeDrive.api, secrets: new SecretBox(randomBytes(32).toString('base64')) },
    publicSheets: { fetchCsv: async (id) => fakeDrive.publicCsv.get(id) ?? null },
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
  const guestPerson = await createPerson(ctx, manager, { displayName: 'Guest', email: 'guest@example.org', role: 'guest', jobTitle: null });
  const contactPerson = await createPerson(ctx, manager, { displayName: 'Contact', email: 'contact@example.org', role: null, jobTitle: 'רכזת מתנדבים' });

  return {
    ctx,
    database,
    clock,
    mailer,
    fakeDrive,
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

/** In-memory stand-in for Google Drive/Sheets. Files are visible only when "picked" (drive.file semantics). */
export function createFakeDrive() {
  const files = new Map<string, GoogleFileMeta & { tables?: SourceTable[] }>();
  const publicCsv = new Map<string, string>();
  const tokens = new Set<string>();
  const check = (t: string) => {
    if (!tokens.has(t)) throw new Error('bad token');
  };
  const api: GoogleWorkspace = {
    async exchangeCode(code) {
      tokens.add(`refresh-${code}`);
      return { refreshToken: `refresh-${code}`, scope: `openid ${DRIVE_FILE_SCOPE}` };
    },
    async accessToken(t) {
      check(t);
      return `access-for-${t}`;
    },
    async getFile(t, id) {
      check(t);
      const f = files.get(id);
      return f ? { id: f.id, name: f.name, mimeType: f.mimeType, webViewLink: f.webViewLink } : null;
    },
    async readSpreadsheet(t, id) {
      check(t);
      return files.get(id)?.tables ?? null;
    },
    async upload(t, file) {
      check(t);
      const id = `uploaded${files.size.toString().padStart(8, '0')}`;
      const mimeType = file.name.endsWith('.xlsx') ? 'application/vnd.google-apps.spreadsheet' : 'application/vnd.google-apps.document';
      const meta = { id, name: file.name.replace(/\.[^.]+$/, ''), mimeType, webViewLink: `https://docs.google.com/x/d/${id}/edit` };
      files.set(id, meta);
      return meta;
    },
    async revoke(t) {
      tokens.delete(t);
    },
  };
  const addSheet = (id: string, name: string, tables: SourceTable[]) =>
    files.set(id, { id, name, mimeType: 'application/vnd.google-apps.spreadsheet', webViewLink: `https://docs.google.com/spreadsheets/d/${id}/edit`, tables });
  return { api, files, publicCsv, addSheet };
}
