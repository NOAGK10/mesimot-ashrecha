import { and, desc, eq } from 'drizzle-orm';
import type { CallDto, CallInput } from '@org/shared';
import type { AppContext } from '../../context';
import { calls, people } from '../../db/schema';
import { forbidden, invalid, notFound } from '../../lib/errors';
import { policy } from '../identity/policy';
import type { Principal } from '../identity/principal';

/**
 * The call log: managers record phone calls (who, when, what happened, what was said).
 * A call is private to the person who logged it – nobody else sees it, other managers included.
 */

function assertAllowed(p: Principal) {
  if (!policy.isManager(p)) throw forbidden();
}

const toDto = (r: typeof calls.$inferSelect): CallDto => ({
  id: r.id,
  callerName: r.callerName,
  phone: r.phone,
  personId: r.personId,
  direction: r.direction,
  status: r.status,
  summary: r.summary,
  occurredAt: r.occurredAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

async function assertPerson(ctx: AppContext, p: Principal, personId: string | null) {
  if (!personId) return;
  const [row] = await ctx.db.select({ orgId: people.orgId }).from(people).where(eq(people.id, personId));
  if (!row || row.orgId !== p.orgId) throw invalid('Unknown person');
}

const mine = (p: Principal, id: string) => and(eq(calls.id, id), eq(calls.orgId, p.orgId), eq(calls.ownerPersonId, p.personId));

export async function listCalls(ctx: AppContext, p: Principal): Promise<CallDto[]> {
  assertAllowed(p);
  const rows = await ctx.db
    .select()
    .from(calls)
    .where(and(eq(calls.orgId, p.orgId), eq(calls.ownerPersonId, p.personId)))
    .orderBy(desc(calls.occurredAt))
    .limit(1000);
  return rows.map(toDto);
}

export async function createCall(ctx: AppContext, p: Principal, input: CallInput): Promise<CallDto> {
  assertAllowed(p);
  await assertPerson(ctx, p, input.personId);
  const [row] = await ctx.db
    .insert(calls)
    .values({ ...input, occurredAt: new Date(input.occurredAt), orgId: p.orgId, ownerPersonId: p.personId, createdAt: ctx.now(), updatedAt: ctx.now() })
    .returning();
  return toDto(row!);
}

export async function updateCall(ctx: AppContext, p: Principal, id: string, input: CallInput): Promise<CallDto> {
  assertAllowed(p);
  await assertPerson(ctx, p, input.personId);
  const [row] = await ctx.db
    .update(calls)
    .set({ ...input, occurredAt: new Date(input.occurredAt), updatedAt: ctx.now() })
    .where(mine(p, id))
    .returning();
  if (!row) throw notFound('Call');
  return toDto(row);
}

export async function deleteCall(ctx: AppContext, p: Principal, id: string): Promise<void> {
  assertAllowed(p);
  const [row] = await ctx.db.delete(calls).where(mine(p, id)).returning({ id: calls.id });
  if (!row) throw notFound('Call');
}
