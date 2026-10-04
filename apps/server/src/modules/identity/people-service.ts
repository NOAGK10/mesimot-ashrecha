import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { PersonDto, createPersonSchema, updatePersonSchema } from '@org/shared';
import { OPEN_STATUSES, defaultAvatarColor } from '@org/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db/client';
import { people, personAvatars, recurrenceDefinitions, recurrenceParticipants, sessions, taskParticipants, tasks } from '../../db/schema';
import { conflict, forbidden, invalid, notFound } from '../../lib/errors';
import { recordAudit } from '../audit/audit';
import { policy } from './policy';
import { actorOf, type Principal } from './principal';

type PersonRow = typeof people.$inferSelect;

export function toPersonDto(r: PersonRow, withEmail: boolean, avatarUpdatedAt: Date | null = null): PersonDto {
  return {
    id: r.id,
    displayName: r.displayName,
    email: withEmail ? r.email : '',
    role: r.role,
    jobTitle: r.jobTitle,
    active: r.deactivatedAt === null,
    hasLogin: r.userId !== null,
    avatarColor: r.avatarColor ?? defaultAvatarColor(r.id),
    avatarVersion: avatarUpdatedAt ? avatarUpdatedAt.getTime() : null,
    responsibilities: r.responsibilities,
  };
}
const toDto = toPersonDto;

/** Guests see names (to know who owns what) but not e-mail addresses. */
export async function listPeople(ctx: AppContext, p: Principal): Promise<PersonDto[]> {
  if (!policy.canListPeople(p)) throw forbidden();
  const rows = await ctx.db
    .select({ person: people, avatarAt: personAvatars.updatedAt })
    .from(people)
    .leftJoin(personAvatars, eq(personAvatars.personId, people.id))
    .where(and(eq(people.orgId, p.orgId), isNull(people.deletedAt)))
    .orderBy(asc(people.displayName));
  return rows.map((r) => toDto(r.person, policy.canManagePeople(p), r.avatarAt));
}

/**
 * Removes a person from the organisation (APPROVED, docs/DECISIONS.md C-27): they disappear from every
 * list and every task they took part in, and can no longer sign in. Tasks they are responsible for must
 * be handed to someone else first, so no work is left without an owner. History keeps their name.
 */
export async function deletePerson(ctx: AppContext, p: Principal, id: string): Promise<void> {
  if (!policy.canManagePeople(p)) throw forbidden();
  if (id === p.personId) throw invalid('You cannot delete yourself');
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const [person] = await tx.select().from(people).where(eq(people.id, id)).for('update');
    if (!person || person.orgId !== p.orgId || person.deletedAt) throw notFound('Person');
    if (person.role === 'manager' && person.deactivatedAt === null && (await countActiveManagers(tx, p.orgId)) <= 1) {
      throw invalid('The organization must keep at least one active manager');
    }

    const [owned] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.ownerPersonId, id), isNull(tasks.deletedAt), isNull(tasks.archivedAt), inArray(tasks.status, [...OPEN_STATUSES])));
    const [recurring] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(recurrenceDefinitions)
      .where(and(eq(recurrenceDefinitions.ownerPersonId, id), ne(recurrenceDefinitions.state, 'ended')));
    if ((owned?.n ?? 0) > 0 || (recurring?.n ?? 0) > 0) {
      throw conflict(
        `${person.displayName} is responsible for ${owned?.n ?? 0} open tasks and ${recurring?.n ?? 0} recurring tasks. Assign them to someone else first.`,
      );
    }

    // Take them off every task they participate in, with an audit entry per task.
    const memberships = await tx.select({ taskId: taskParticipants.taskId }).from(taskParticipants).where(eq(taskParticipants.personId, id));
    if (memberships.length) {
      await tx.delete(taskParticipants).where(eq(taskParticipants.personId, id));
      const affected = await tx.select({ id: tasks.id, orgId: tasks.orgId }).from(tasks).where(inArray(tasks.id, memberships.map((m) => m.taskId)));
      for (const t of affected) {
        await recordAudit(tx, { orgId: t.orgId, entityType: 'task', entityId: t.id, type: 'task.participants_changed', actor: actorOf(p), data: { added: [], removed: [id] } });
      }
    }
    await tx.delete(recurrenceParticipants).where(eq(recurrenceParticipants.personId, id));
    await tx.update(people).set({ deletedAt: now, deactivatedAt: person.deactivatedAt ?? now }).where(eq(people.id, id));
    await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.personId, id), isNull(sessions.revokedAt)));
    await recordAudit(tx, { orgId: p.orgId, entityType: 'person', entityId: id, type: 'person.deleted', actor: actorOf(p), data: { displayName: person.displayName } });
  });
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
