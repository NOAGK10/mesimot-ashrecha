import { and, asc, desc, eq, gt, inArray, lte } from 'drizzle-orm';
import type { z } from 'zod';
import type { RecurrenceDto, createRecurrenceSchema, updateRecurrenceSchema } from '@org/shared';
import { OPEN_STATUSES } from '@org/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db/client';
import { organizations, recurrenceDefinitions, recurrenceParticipants, tasks } from '../../db/schema';
import { addDays, todayIn, type IsoDate } from '../../lib/dates';
import { forbidden, invalid, notFound, staleVersion } from '../../lib/errors';
import { recordAudit } from '../audit/audit';
import { notifyAssigned, replanReminders } from '../notifications/scheduling';
import { getOrg } from '../identity/org';
import { policy } from '../identity/policy';
import { SYSTEM_ACTOR, actorOf, type Actor, type Principal } from '../identity/principal';
import { assertActivePeople, insertTask, type TaskWithParticipants } from '../tasks/task-store';
import { afterCompletion, scheduledAfter, scheduledOnOrAfter, type RecurrenceRule } from './rules';

/**
 * Recurrence Definition vs. Task Occurrence (architecture rule 4):
 * a definition never appears in task lists; the worker (schedule mode) or completion of the previous
 * occurrence (after_completion mode) materialises occurrences as ordinary tasks.
 * Behaviour decisions are PROPOSED — see docs/DECISIONS.md, D6.
 */

type DefinitionRow = typeof recurrenceDefinitions.$inferSelect;
/** Upper bound of occurrences created for one definition in one pass (protects against runaway catch-up). */
const MAX_OCCURRENCES_PER_PASS = 60;

const ruleOf = (d: DefinitionRow): RecurrenceRule => ({
  freq: d.freq,
  interval: d.interval,
  byWeekday: d.byWeekday,
  byMonthDay: d.byMonthDay,
  startDate: d.startDate,
  endDate: d.endDate,
});

async function participantIdsOf(db: Db, definitionId: string): Promise<string[]> {
  const rows = await db
    .select({ personId: recurrenceParticipants.personId })
    .from(recurrenceParticipants)
    .where(eq(recurrenceParticipants.definitionId, definitionId));
  return rows.map((r) => r.personId);
}

function toDto(d: DefinitionRow, participantIds: string[]): RecurrenceDto {
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    ownerPersonId: d.ownerPersonId,
    participantIds,
    mode: d.mode,
    freq: d.freq,
    interval: d.interval,
    byWeekday: d.byWeekday,
    byMonthDay: d.byMonthDay,
    startDate: d.startDate,
    endDate: d.endDate,
    state: d.state,
    nextOccurrenceDate: d.nextOccurrenceDate,
    version: d.version,
  };
}

/** Creates one occurrence (idempotent per date) and its notifications. Returns null if it already existed. */
async function createOccurrence(
  tx: Db,
  def: DefinitionRow,
  occurrenceDate: IsoDate,
  actor: Actor,
  now: Date,
): Promise<TaskWithParticipants | null> {
  const participantIds = await participantIdsOf(tx, def.id);
  const task = await insertTask(
    tx,
    {
      orgId: def.orgId,
      title: def.title,
      description: def.description,
      ownerPersonId: def.ownerPersonId,
      dueDate: occurrenceDate,
      participantIds,
      createdByPersonId: null,
      recurrence: { definitionId: def.id, occurrenceDate },
    },
    now,
  );
  if (!task) return null;
  await recordAudit(tx, {
    orgId: def.orgId,
    entityType: 'task',
    entityId: task.id,
    type: 'task.created',
    actor,
    data: { recurrenceDefinitionId: def.id, occurrenceDate, ownerPersonId: task.ownerPersonId, dueDate: task.dueDate },
  });
  await notifyAssigned(tx, task, [task.ownerPersonId, ...task.participantIds], null, now);
  await replanReminders(tx, { ...task, open: true }, now);
  return task;
}

/** Schedule mode: materialise every occurrence up to `horizon` and advance the cursor. Caller holds the row lock. */
async function generateScheduled(tx: Db, def: DefinitionRow, horizon: IsoDate, actor: Actor, now: Date): Promise<number> {
  if (def.mode !== 'schedule' || def.state !== 'active') return 0;
  const rule = ruleOf(def);
  let next = def.nextOccurrenceDate;
  let created = 0;
  for (let i = 0; next !== null && next <= horizon && i < MAX_OCCURRENCES_PER_PASS; i++) {
    if (await createOccurrence(tx, def, next, actor, now)) created++;
    next = scheduledAfter(rule, next);
  }
  const ended = next === null;
  await tx
    .update(recurrenceDefinitions)
    .set({ nextOccurrenceDate: next, state: ended ? 'ended' : def.state, updatedAt: now })
    .where(eq(recurrenceDefinitions.id, def.id));
  if (ended) {
    await recordAudit(tx, { orgId: def.orgId, entityType: 'recurrence', entityId: def.id, type: 'recurrence.ended', actor: SYSTEM_ACTOR, data: { reason: 'end_date_reached' } });
  }
  return created;
}

/** Worker entry point. Each definition is processed in its own transaction with a row lock. */
export async function generateDueOccurrences(ctx: AppContext): Promise<number> {
  const now = ctx.now();
  let total = 0;
  const orgs = await ctx.db.select().from(organizations);
  for (const org of orgs) {
    const horizon = addDays(todayIn(org.timezone, now), ctx.config.RECURRENCE_HORIZON_DAYS);
    const due = await ctx.db
      .select({ id: recurrenceDefinitions.id })
      .from(recurrenceDefinitions)
      .where(
        and(
          eq(recurrenceDefinitions.orgId, org.id),
          eq(recurrenceDefinitions.mode, 'schedule'),
          eq(recurrenceDefinitions.state, 'active'),
          lte(recurrenceDefinitions.nextOccurrenceDate, horizon),
        ),
      );
    for (const { id } of due) {
      total += await ctx.db.transaction(async (tx) => {
        const [def] = await tx.select().from(recurrenceDefinitions).where(eq(recurrenceDefinitions.id, id)).for('update');
        return def ? generateScheduled(tx, def, horizon, SYSTEM_ACTOR, now) : 0;
      });
    }
  }
  return total;
}

/**
 * After-completion mode, called inside the transaction that completes an occurrence.
 * Creates the next occurrence only if this was the latest one, so reopen + complete cannot duplicate.
 */
export async function onOccurrenceCompleted(tx: Db, task: TaskWithParticipants, completedOn: IsoDate, now: Date): Promise<void> {
  if (!task.recurrenceDefinitionId || !task.occurrenceDate) return;
  const [def] = await tx
    .select()
    .from(recurrenceDefinitions)
    .where(eq(recurrenceDefinitions.id, task.recurrenceDefinitionId))
    .for('update');
  if (!def || def.mode !== 'after_completion' || def.state !== 'active') return;
  const [later] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.recurrenceDefinitionId, def.id), gt(tasks.occurrenceDate, task.occurrenceDate)))
    .limit(1);
  if (later) return;
  const next = afterCompletion(ruleOf(def), completedOn);
  if (next === null) {
    await tx.update(recurrenceDefinitions).set({ state: 'ended', updatedAt: now }).where(eq(recurrenceDefinitions.id, def.id));
    await recordAudit(tx, { orgId: def.orgId, entityType: 'recurrence', entityId: def.id, type: 'recurrence.ended', actor: SYSTEM_ACTOR, data: { reason: 'end_date_reached' } });
    return;
  }
  // Completing far ahead of the due date must still move the series forward.
  const date = next > task.occurrenceDate ? next : addDays(task.occurrenceDate, 1);
  await createOccurrence(tx, def, date, SYSTEM_ACTOR, now);
}

// ---------------- Manager-facing operations ----------------

function validateRule(input: { mode: string; freq: string; byWeekday: number[]; startDate: string; endDate: string | null }) {
  if (input.endDate && input.endDate < input.startDate) throw invalid('End date must not be before start date');
  if (input.mode === 'after_completion' && input.byWeekday.length) {
    throw invalid('Weekday selection applies only to fixed-schedule recurrence');
  }
}

export async function createRecurrence(
  ctx: AppContext,
  p: Principal,
  input: z.output<typeof createRecurrenceSchema>,
): Promise<RecurrenceDto> {
  if (!policy.canManageRecurrence(p)) throw forbidden();
  validateRule(input);
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    await assertActivePeople(tx, p.orgId, [input.ownerPersonId, ...input.participantIds]);
    const org = await getOrg(tx, p.orgId);
    const rule: RecurrenceRule = { ...input };
    const firstDate = input.mode === 'schedule' ? scheduledOnOrAfter(rule, input.startDate) : input.startDate;
    if (firstDate === null) throw invalid('The rule produces no occurrences before its end date');

    const [def] = await tx
      .insert(recurrenceDefinitions)
      .values({ ...input, orgId: p.orgId, nextOccurrenceDate: input.mode === 'schedule' ? firstDate : null, createdByPersonId: p.personId, createdAt: now, updatedAt: now })
      .returning();
    const participantIds = [...new Set(input.participantIds)].filter((id) => id !== input.ownerPersonId);
    if (participantIds.length) {
      await tx.insert(recurrenceParticipants).values(participantIds.map((personId) => ({ definitionId: def!.id, personId })));
    }
    await recordAudit(tx, { orgId: p.orgId, entityType: 'recurrence', entityId: def!.id, type: 'recurrence.created', actor: actorOf(p), data: { ...input } });

    if (def!.mode === 'after_completion') {
      await createOccurrence(tx, def!, firstDate, actorOf(p), now);
    } else {
      const horizon = addDays(todayIn(org.timezone, now), ctx.config.RECURRENCE_HORIZON_DAYS);
      await generateScheduled(tx, def!, horizon, actorOf(p), now);
    }
    const [fresh] = await tx.select().from(recurrenceDefinitions).where(eq(recurrenceDefinitions.id, def!.id));
    return toDto(fresh!, participantIds);
  });
}

export async function listRecurrences(ctx: AppContext, p: Principal): Promise<RecurrenceDto[]> {
  if (!policy.canManageRecurrence(p)) throw forbidden();
  const defs = await ctx.db
    .select()
    .from(recurrenceDefinitions)
    .where(eq(recurrenceDefinitions.orgId, p.orgId))
    .orderBy(asc(recurrenceDefinitions.state), asc(recurrenceDefinitions.title));
  const parts = defs.length
    ? await ctx.db.select().from(recurrenceParticipants).where(inArray(recurrenceParticipants.definitionId, defs.map((d) => d.id)))
    : [];
  return defs.map((d) => toDto(d, parts.filter((x) => x.definitionId === d.id).map((x) => x.personId)));
}

async function lockDefinition(tx: Db, p: Principal, id: string, version: number): Promise<DefinitionRow> {
  const [def] = await tx.select().from(recurrenceDefinitions).where(eq(recurrenceDefinitions.id, id)).for('update');
  if (!def || def.orgId !== p.orgId) throw notFound('Recurrence');
  if (def.version !== version) throw staleVersion();
  return def;
}

/** Changes apply to occurrences generated from now on; existing occurrences are left as they are. */
export async function updateRecurrence(
  ctx: AppContext,
  p: Principal,
  id: string,
  input: z.output<typeof updateRecurrenceSchema>,
): Promise<RecurrenceDto> {
  if (!policy.canManageRecurrence(p)) throw forbidden();
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const def = await lockDefinition(tx, p, id, input.version);
    if (def.state === 'ended') throw invalid('This recurrence has ended');
    const { version: _v, participantIds, ...fields } = input;
    if (fields.ownerPersonId) await assertActivePeople(tx, p.orgId, [fields.ownerPersonId]);
    if (fields.endDate && fields.endDate < def.startDate) throw invalid('End date must not be before start date');

    let nextOccurrenceDate = def.nextOccurrenceDate;
    if (fields.endDate !== undefined && def.mode === 'schedule' && nextOccurrenceDate) {
      if (fields.endDate !== null && nextOccurrenceDate > fields.endDate) nextOccurrenceDate = null;
    }
    const [updated] = await tx
      .update(recurrenceDefinitions)
      .set({ ...fields, nextOccurrenceDate, state: nextOccurrenceDate === null && def.mode === 'schedule' ? 'ended' : def.state, updatedAt: now, version: def.version + 1 })
      .where(eq(recurrenceDefinitions.id, id))
      .returning();

    let finalParticipants = await participantIdsOf(tx, id);
    if (participantIds) {
      await assertActivePeople(tx, p.orgId, participantIds);
      await tx.delete(recurrenceParticipants).where(eq(recurrenceParticipants.definitionId, id));
      finalParticipants = [...new Set(participantIds)].filter((x) => x !== updated!.ownerPersonId);
      if (finalParticipants.length) {
        await tx.insert(recurrenceParticipants).values(finalParticipants.map((personId) => ({ definitionId: id, personId })));
      }
    }
    await recordAudit(tx, { orgId: p.orgId, entityType: 'recurrence', entityId: id, type: 'recurrence.updated', actor: actorOf(p), data: { ...fields, ...(participantIds ? { participantIds } : {}) } });
    return toDto(updated!, finalParticipants);
  });
}

export async function setRecurrenceState(
  ctx: AppContext,
  p: Principal,
  id: string,
  version: number,
  action: 'pause' | 'resume' | 'end',
): Promise<RecurrenceDto> {
  if (!policy.canManageRecurrence(p)) throw forbidden();
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const def = await lockDefinition(tx, p, id, version);
    const org = await getOrg(tx, p.orgId);
    const today = todayIn(org.timezone, now);
    const patch: Partial<DefinitionRow> = { updatedAt: now, version: def.version + 1 };

    if (action === 'pause') {
      if (def.state !== 'active') throw invalid('Only an active recurrence can be paused');
      patch.state = 'paused';
    } else if (action === 'end') {
      if (def.state === 'ended') throw invalid('Already ended');
      patch.state = 'ended';
      patch.nextOccurrenceDate = null;
    } else {
      if (def.state !== 'paused') throw invalid('Only a paused recurrence can be resumed');
      patch.state = 'active';
      if (def.mode === 'schedule') {
        // Dates that fell inside the pause are skipped, not back-filled.
        const from = def.nextOccurrenceDate && def.nextOccurrenceDate > today ? def.nextOccurrenceDate : today;
        patch.nextOccurrenceDate = scheduledOnOrAfter(ruleOf(def), from);
        if (patch.nextOccurrenceDate === null) patch.state = 'ended';
      }
    }
    const [updated] = await tx.update(recurrenceDefinitions).set(patch).where(eq(recurrenceDefinitions.id, id)).returning();
    await recordAudit(tx, { orgId: p.orgId, entityType: 'recurrence', entityId: id, type: `recurrence.${action === 'end' ? 'ended' : action + 'd'}`, actor: actorOf(p) });

    if (action === 'resume' && updated!.state === 'active') {
      if (updated!.mode === 'schedule') {
        await generateScheduled(tx, updated!, addDays(today, ctx.config.RECURRENCE_HORIZON_DAYS), actorOf(p), now);
      } else {
        // If the last occurrence was completed while paused, restart the series today.
        const [open] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.recurrenceDefinitionId, id), inArray(tasks.status, [...OPEN_STATUSES])))
          .limit(1);
        if (!open) {
          const [last] = await tx
            .select({ occurrenceDate: tasks.occurrenceDate })
            .from(tasks)
            .where(eq(tasks.recurrenceDefinitionId, id))
            .orderBy(desc(tasks.occurrenceDate))
            .limit(1);
          const date = last?.occurrenceDate && last.occurrenceDate >= today ? addDays(last.occurrenceDate, 1) : today;
          await createOccurrence(tx, updated!, date, actorOf(p), now);
        }
      }
    }
    const [fresh] = await tx.select().from(recurrenceDefinitions).where(eq(recurrenceDefinitions.id, id));
    return toDto(fresh!, await participantIdsOf(tx, id));
  });
}
