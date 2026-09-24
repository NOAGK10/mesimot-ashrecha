import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { MeDto } from '@org/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db/client';
import { magicLinks, people, sessions, tasks, taskParticipants, users } from '../../db/schema';
import { AppError, forbidden, invalid, notFound, unauthenticated } from '../../lib/errors';
import { hashToken, newToken } from '../../lib/tokens';
import { recordAudit } from '../audit/audit';
import { getOrg } from './org';
import { policy } from './policy';
import { actorOf, type Principal } from './principal';

/**
 * Authentication boundary. Three ways in (decision D1 — all three were chosen):
 *  1. Google sign-in, for people with role manager/guest.
 *  2. Magic link, scoped to one task, for anyone involved in that task (incl. contacts without login).
 *  3. Development-only e-mail login (refused in production by config validation).
 * There is no self-registration: a person must first be added by a manager.
 */

const DAY_MS = 86_400_000;

async function openSession(db: Db, personId: string, scopeTaskId: string | null, expiresAt: Date): Promise<string> {
  const { token, hash } = newToken();
  await db.insert(sessions).values({ tokenHash: hash, personId, scopeTaskId, expiresAt });
  return token;
}

async function findLoginPerson(db: Db, email: string) {
  const [person] = await db
    .select()
    .from(people)
    .where(and(sql`lower(${people.email}) = ${email.toLowerCase()}`, isNull(people.deactivatedAt)));
  if (!person || person.role === null) throw forbidden('This account has no access to the organization');
  return person;
}

export async function loginWithGoogle(ctx: AppContext, credential: string): Promise<{ token: string; expiresAt: Date }> {
  if (!ctx.google) throw new AppError(400, 'google_disabled', 'Google sign-in is not configured');
  const identity = await ctx.google.verify(credential);
  if (!identity) throw unauthenticated();
  return ctx.db.transaction(async (tx) => {
    const person = await findLoginPerson(tx, identity.email);
    const now = ctx.now();
    const [user] = await tx
      .insert(users)
      .values({ email: identity.email, googleSub: identity.sub, lastLoginAt: now })
      .onConflictDoUpdate({ target: users.email, set: { googleSub: identity.sub, lastLoginAt: now } })
      .returning();
    if (person.userId !== user!.id) await tx.update(people).set({ userId: user!.id }).where(eq(people.id, person.id));
    const expiresAt = new Date(now.getTime() + ctx.config.SESSION_TTL_DAYS * DAY_MS);
    return { token: await openSession(tx, person.id, null, expiresAt), expiresAt };
  });
}

export async function loginForDevelopment(ctx: AppContext, email: string): Promise<{ token: string; expiresAt: Date }> {
  if (!ctx.config.AUTH_DEV_LOGIN || ctx.config.NODE_ENV === 'production') throw notFound('Route');
  const person = await findLoginPerson(ctx.db, email);
  const expiresAt = new Date(ctx.now().getTime() + ctx.config.SESSION_TTL_DAYS * DAY_MS);
  return { token: await openSession(ctx.db, person.id, null, expiresAt), expiresAt };
}

export async function logout(ctx: AppContext, token: string): Promise<void> {
  await ctx.db.update(sessions).set({ revokedAt: ctx.now() }).where(eq(sessions.tokenHash, hashToken(token)));
}

/** Resolves the session cookie to a Principal, re-checking the person's current role on every request. */
export async function resolvePrincipal(ctx: AppContext, token: string | undefined): Promise<Principal | null> {
  if (!token) return null;
  const [row] = await ctx.db
    .select({ session: sessions, person: people })
    .from(sessions)
    .innerJoin(people, eq(people.id, sessions.personId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, ctx.now())));
  if (!row || row.person.deactivatedAt) return null;
  const { session, person } = row;
  if (session.scopeTaskId) {
    return { personId: person.id, orgId: person.orgId, access: 'link', scopeTaskId: session.scopeTaskId, via: 'magic_link' };
  }
  if (person.role === null) return null;
  return { personId: person.id, orgId: person.orgId, access: person.role, scopeTaskId: null, via: 'session' };
}

export async function describePrincipal(ctx: AppContext, p: Principal): Promise<MeDto> {
  const [person] = await ctx.db.select().from(people).where(eq(people.id, p.personId));
  const org = await getOrg(ctx.db, p.orgId);
  return {
    personId: p.personId,
    displayName: person!.displayName,
    email: person!.email,
    access: p.access,
    scopeTaskId: p.scopeTaskId,
    organization: { id: org.id, name: org.name, timezone: org.timezone },
  };
}

// ---------------- Magic links ----------------

async function isInvolved(db: Db, taskId: string, personId: string): Promise<boolean> {
  const [task] = await db.select({ owner: tasks.ownerPersonId }).from(tasks).where(eq(tasks.id, taskId));
  if (!task) return false;
  if (task.owner === personId) return true;
  const [part] = await db
    .select({ one: sql`1` })
    .from(taskParticipants)
    .where(and(eq(taskParticipants.taskId, taskId), eq(taskParticipants.personId, personId)));
  return Boolean(part);
}

/** Creates a task-scoped link. Used by the notification worker and by managers who want to share a link. */
export async function issueMagicLink(ctx: AppContext, db: Db, personId: string, taskId: string): Promise<string> {
  const { token, hash } = newToken();
  const expiresAt = new Date(ctx.now().getTime() + ctx.config.MAGIC_LINK_TTL_DAYS * DAY_MS);
  await db.insert(magicLinks).values({ tokenHash: hash, personId, taskId, expiresAt });
  return `${ctx.config.APP_URL}/api/auth/magic?token=${encodeURIComponent(token)}`;
}

export async function issueMagicLinkAsManager(ctx: AppContext, p: Principal, taskId: string, personId: string): Promise<string> {
  if (!policy.isManager(p)) throw forbidden();
  return ctx.db.transaction(async (tx) => {
    const [task] = await tx.select({ orgId: tasks.orgId }).from(tasks).where(eq(tasks.id, taskId));
    if (!task || task.orgId !== p.orgId) throw notFound('Task');
    if (!(await isInvolved(tx, taskId, personId))) throw invalid('That person is not involved in this task');
    const url = await issueMagicLink(ctx, tx, personId, taskId);
    await recordAudit(tx, { orgId: p.orgId, entityType: 'task', entityId: taskId, type: 'task.link_issued', actor: actorOf(p), data: { personId } });
    return url;
  });
}

/**
 * Exchanges a magic-link token for a task-scoped session. The link stays valid until it expires
 * (reminder e-mails reuse the same flow), but stops working as soon as the person is no longer
 * involved in the task or is deactivated.
 */
export async function redeemMagicLink(ctx: AppContext, token: string): Promise<{ token: string; expiresAt: Date; taskId: string }> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [link] = await tx
      .select({ link: magicLinks, person: people })
      .from(magicLinks)
      .innerJoin(people, eq(people.id, magicLinks.personId))
      .where(and(eq(magicLinks.tokenHash, hashToken(token)), isNull(magicLinks.revokedAt), gt(magicLinks.expiresAt, now)));
    if (!link || link.person.deactivatedAt) throw new AppError(401, 'link_invalid', 'This link is invalid or has expired');
    if (!(await isInvolved(tx, link.link.taskId, link.person.id))) {
      throw new AppError(401, 'link_invalid', 'This link is no longer valid for this task');
    }
    await tx.update(magicLinks).set({ lastUsedAt: now }).where(eq(magicLinks.id, link.link.id));
    const session = await openSession(tx, link.person.id, link.link.taskId, link.link.expiresAt);
    return { token: session, expiresAt: link.link.expiresAt, taskId: link.link.taskId };
  });
}
