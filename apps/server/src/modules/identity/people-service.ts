import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { PersonDto, createPersonSchema, updatePersonSchema } from '@org/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db/client';
import { people, sessions } from '../../db/schema';
import { conflict, forbidden, invalid, notFound } from '../../lib/errors';
import { recordAudit } from '../audit/audit';
import { policy } from './policy';
import { actorOf, type Principal } from './principal';

type PersonRow = typeof people.$inferSelect;

function toDto(r: PersonRow, withEmail: boolean): PersonDto {
  return {
    id: r.id,
    displayName: r.displayName,
    email: withEmail ? r.email : '',
    role: r.role,
    jobTitle: r.jobTitle,
    active: r.deactivatedAt === null,
    hasLogin: r.userId !== null,
  };
}

/** Guests see names (to know who owns what) but not e-mail addresses. */
export async function listPeople(ctx: AppContext, p: Principal): Promise<PersonDto[]> {
  if (!policy.canListPeople(p)) throw forbidden();
  const rows = await ctx.db.select().from(people).where(eq(people.orgId, p.orgId)).orderBy(asc(people.displayName));
  return rows.map((r) => toDto(r, policy.canManagePeople(p)));
}

async function assertEmailFree(db: Db, orgId: string, email: string, exceptId?: string) {
  const [dup] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.orgId, orgId), sql`lower(${people.email}) = ${email.toLowerCase()}`, exceptId ? ne(people.id, exceptId) : undefined));
  if (dup) throw conflict('A person with this e-mail already exists');
}

async function countActiveManagers(db: Db, orgId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(people)
    .where(and(eq(people.orgId, orgId), eq(people.role, 'manager'), isNull(people.deactivatedAt)));
  return row?.n ?? 0;
}

export async function createPerson(ctx: AppContext, p: Principal, input: z.output<typeof createPersonSchema>): Promise<PersonDto> {
  if (!policy.canManagePeople(p)) throw forbidden();
  return ctx.db.transaction(async (tx) => {
    await assertEmailFree(tx, p.orgId, input.email);
    const [row] = await tx.insert(people).values({ ...input, email: input.email.toLowerCase(), orgId: p.orgId }).returning();
    await recordAudit(tx, { orgId: p.orgId, entityType: 'person', entityId: row!.id, type: 'person.created', actor: actorOf(p), data: { ...input } });
    return toDto(row!, true);
  });
}

export async function updatePerson(ctx: AppContext, p: Principal, id: string, input: z.output<typeof updatePersonSchema>): Promise<PersonDto> {
  if (!policy.canManagePeople(p)) throw forbidden();
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [current] = await tx.select().from(people).where(eq(people.id, id)).for('update');
    if (!current || current.orgId !== p.orgId) throw notFound('Person');
    if (input.email) await assertEmailFree(tx, p.orgId, input.email, id);

    const losesManager =
      current.role === 'manager' &&
      current.deactivatedAt === null &&
      ((input.role !== undefined && input.role !== 'manager') || input.active === false);
    if (losesManager && (await countActiveManagers(tx, p.orgId)) <= 1) throw invalid('The organization must keep at least one active manager');

    const { active, ...fields } = input;
    const patch: Partial<PersonRow> = { ...fields };
    if (fields.email) patch.email = fields.email.toLowerCase();
    if (active !== undefined) patch.deactivatedAt = active ? null : (current.deactivatedAt ?? now);

    const [row] = await tx.update(people).set(patch).where(eq(people.id, id)).returning();
    // Access changes take effect immediately: drop existing sessions.
    if (active === false || (input.role !== undefined && input.role !== current.role)) {
      await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.personId, id), isNull(sessions.revokedAt)));
    }
    await recordAudit(tx, { orgId: p.orgId, entityType: 'person', entityId: id, type: 'person.updated', actor: actorOf(p), data: { ...input } });
    return toDto(row!, true);
  });
}
