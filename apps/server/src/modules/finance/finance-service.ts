import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FinanceEntryDto, FinanceEntryInput, FinanceSummaryDto } from '@org/shared';
import type { AppContext } from '../../context';
import { financeEntries, organizations, people } from '../../db/schema';
import { forbidden, invalid, notFound } from '../../lib/errors';
import { recordAudit } from '../audit/audit';
import { policy } from '../identity/policy';
import { actorOf, type Principal } from '../identity/principal';

/**
 * Finance is for managers only: they see the balance, report income and expenses, delete reports and
 * set the opening amount. The balance is the opening amount plus income minus expenses.
 */

function assertAllowed(p: Principal) {
  if (!policy.isManager(p)) throw forbidden();
}

export async function getFinance(ctx: AppContext, p: Principal): Promise<FinanceSummaryDto> {
  assertAllowed(p);
  const [org] = await ctx.db.select({ opening: organizations.financeOpeningAgorot }).from(organizations).where(eq(organizations.id, p.orgId));
  const live = and(eq(financeEntries.orgId, p.orgId), isNull(financeEntries.deletedAt));
  const [totals] = await ctx.db
    .select({
      income: sql<string>`coalesce(sum(${financeEntries.amountAgorot}) filter (where ${financeEntries.kind} = 'income'), 0)`,
      expense: sql<string>`coalesce(sum(${financeEntries.amountAgorot}) filter (where ${financeEntries.kind} = 'expense'), 0)`,
    })
    .from(financeEntries)
    .where(live);
  const rows = await ctx.db
    .select({ e: financeEntries, personName: people.displayName })
    .from(financeEntries)
    .innerJoin(people, eq(people.id, financeEntries.personId))
    .where(live)
    .orderBy(desc(financeEntries.occurredOn), desc(financeEntries.createdAt))
    .limit(2000);
  const opening = Number(org?.opening ?? 0);
  const income = Number(totals?.income ?? 0);
  const expense = Number(totals?.expense ?? 0);
  return {
    openingAgorot: opening,
    incomeAgorot: income,
    expenseAgorot: expense,
    balanceAgorot: opening + income - expense,
    canSetOpening: policy.isManager(p),
    entries: rows.map(({ e, personName }): FinanceEntryDto => ({
      id: e.id,
      kind: e.kind,
      amountAgorot: Number(e.amountAgorot),
      description: e.description,
      personId: e.personId,
      personName,
      occurredOn: e.occurredOn,
      reportedByPersonId: e.reportedByPersonId,
      createdAt: e.createdAt.toISOString(),
      canDelete: policy.isManager(p) || e.reportedByPersonId === p.personId,
    })),
  };
}

export async function reportFinance(ctx: AppContext, p: Principal, input: FinanceEntryInput): Promise<void> {
  assertAllowed(p);
  const [person] = await ctx.db.select({ orgId: people.orgId }).from(people).where(eq(people.id, input.personId));
  if (!person || person.orgId !== p.orgId) throw invalid('Unknown person');
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(financeEntries)
      .values({ ...input, orgId: p.orgId, reportedByPersonId: p.personId, createdAt: ctx.now() })
      .returning({ id: financeEntries.id });
    await recordAudit(tx, { orgId: p.orgId, entityType: 'organization', entityId: p.orgId, type: `finance.${input.kind}`, actor: actorOf(p), data: { entryId: row!.id, amountAgorot: input.amountAgorot } });
  });
}

export async function deleteFinanceEntry(ctx: AppContext, p: Principal, id: string): Promise<void> {
  assertAllowed(p);
  const [e] = await ctx.db.select().from(financeEntries).where(and(eq(financeEntries.id, id), eq(financeEntries.orgId, p.orgId), isNull(financeEntries.deletedAt)));
  if (!e) throw notFound('Report');
  await ctx.db.update(financeEntries).set({ deletedAt: ctx.now(), deletedByPersonId: p.personId }).where(eq(financeEntries.id, id));
}

export async function setFinanceOpening(ctx: AppContext, p: Principal, amountAgorot: number): Promise<void> {
  if (!policy.isManager(p)) throw forbidden();
  await ctx.db.update(organizations).set({ financeOpeningAgorot: amountAgorot }).where(eq(organizations.id, p.orgId));
}
