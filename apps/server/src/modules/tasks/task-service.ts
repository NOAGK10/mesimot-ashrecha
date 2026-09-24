import { and, asc, eq, exists, gt, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  TaskDetailDto,
  TaskDto,
  changeStatusSchema,
  createTaskSchema,
  listTasksQuerySchema,
  setParticipantsSchema,
  updateTaskSchema,
} from '@org/shared';
import { OPEN_STATUSES } from '@org/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db/client';
import { people, taskParticipants, tasks } from '../../db/schema';
import { endOfWeek, todayIn } from '../../lib/dates';
import { forbidden, invalid, notFound, staleVersion } from '../../lib/errors';
import { listAudit, recordAudit } from '../audit/audit';
import { documentsOfTask } from '../documents/document-service';
import { getOrg } from '../identity/org';
import { policy } from '../identity/policy';
import { actorOf, type Principal } from '../identity/principal';
import { cancelPendingReminders, notifyAssigned, replanReminders } from '../notifications/scheduling';
import { onOccurrenceCompleted } from '../recurrence/recurrence-service';
import { allowedTransitions, assertTransition, isOpen } from './lifecycle';
import { assertActivePeople, insertTask, loadTask, participantsOf, toTaskDto, type TaskWithParticipants } from './task-store';

/** Task Management module: the only entry point that creates or changes tasks on behalf of people. */

async function today(db: Db, orgId: string, now: Date) {
  return todayIn((await getOrg(db, orgId)).timezone, now);
}

/** Loads and row-locks a task, then checks organisation, visibility and optimistic version. */
async function lockTask(tx: Db, p: Principal, id: string, version: number): Promise<TaskWithParticipants> {
  const task = await loadTask(tx, id, true);
  if (!task || !policy.canViewTask(p, task)) throw notFound('Task');
  if (task.version !== version) throw staleVersion();
  return task;
}

async function bump(tx: Db, id: string, patch: Partial<typeof tasks.$inferInsert>, now: Date) {
  await tx
    .update(tasks)
    .set({ ...patch, updatedAt: now, version: sql`${tasks.version} + 1` })
    .where(eq(tasks.id, id));
}

async function reload(tx: Db, id: string, now: Date): Promise<TaskDto> {
  const task = (await loadTask(tx, id))!;
  return toTaskDto(task, await today(tx, task.orgId, now));
}

const reminderTarget = (t: TaskWithParticipants) => ({ ...t, open: isOpen(t.status) && t.archivedAt === null });

export async function createTask(ctx: AppContext, p: Principal, input: z.output<typeof createTaskSchema>): Promise<TaskDto> {
  if (!policy.canCreateTask(p)) throw forbidden();
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    await assertActivePeople(tx, p.orgId, [input.ownerPersonId, ...input.participantIds]);
    const task = (await insertTask(tx, { ...input, orgId: p.orgId, createdByPersonId: p.personId }, now))!;
    await recordAudit(tx, {
      orgId: p.orgId,
      entityType: 'task',
      entityId: task.id,
      type: 'task.created',
      actor: actorOf(p),
      data: { title: task.title, ownerPersonId: task.ownerPersonId, dueDate: task.dueDate, participantIds: task.participantIds },
    });
    await notifyAssigned(tx, task, [task.ownerPersonId, ...task.participantIds], p.personId, now);
    await replanReminders(tx, reminderTarget(task), now);
    return toTaskDto(task, await today(tx, p.orgId, now));
  });
}

export async function updateTask(ctx: AppContext, p: Principal, id: string, input: z.output<typeof updateTaskSchema>): Promise<TaskDto> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const task = await lockTask(tx, p, id, input.version);
    if (!policy.canEditTask(p, task)) throw forbidden();
    if (task.archivedAt) throw invalid('Archived tasks are read-only. Unarchive first.');

    const patch: Partial<typeof tasks.$inferInsert> = {};
    const audit = (type: string, data: Record<string, unknown>) =>
      recordAudit(tx, { orgId: p.orgId, entityType: 'task', entityId: id, type, actor: actorOf(p), data });

    const details: Record<string, unknown> = {};
    if (input.title !== undefined && input.title !== task.title) (patch.title = input.title), (details.title = { from: task.title, to: input.title });
    if (input.description !== undefined && input.description !== task.description) (patch.description = input.description), (details.description = true);
    if (Object.keys(details).length) await audit('task.updated', details);

    if (input.dueDate !== undefined && input.dueDate !== task.dueDate) {
      patch.dueDate = input.dueDate;
      await audit('task.due_date_changed', { from: task.dueDate, to: input.dueDate });
    }
    if (input.ownerPersonId !== undefined && input.ownerPersonId !== task.ownerPersonId) {
      await assertActivePeople(tx, p.orgId, [input.ownerPersonId]);
      patch.ownerPersonId = input.ownerPersonId;
      await audit('task.owner_changed', { from: task.ownerPersonId, to: input.ownerPersonId });
      // The new owner stops being a plain participant.
      await tx.delete(taskParticipants).where(and(eq(taskParticipants.taskId, id), eq(taskParticipants.personId, input.ownerPersonId)));
      await notifyAssigned(tx, task, [input.ownerPersonId], p.personId, now);
    }
    if (Object.keys(patch).length === 0) return toTaskDto(task, await today(tx, p.orgId, now));

    await bump(tx, id, patch, now);
    const updated = (await loadTask(tx, id))!;
    if (patch.dueDate !== undefined || patch.ownerPersonId !== undefined) await replanReminders(tx, reminderTarget(updated), now);
    return toTaskDto(updated, await today(tx, p.orgId, now));
  });
}

export async function changeStatus(ctx: AppContext, p: Principal, id: string, input: z.output<typeof changeStatusSchema>): Promise<TaskDto> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const task = await lockTask(tx, p, id, input.version);
    if (!policy.canChangeStatus(p, task)) throw forbidden();
    assertTransition(task.status, input.status, task.archivedAt !== null);

    const completing = input.status === 'completed';
    await bump(tx, id, { status: input.status, completedAt: completing ? now : null }, now);
    await recordAudit(tx, { orgId: p.orgId, entityType: 'task', entityId: id, type: 'task.status_changed', actor: actorOf(p), data: { from: task.status, to: input.status, ...(input.note ? { note: input.note } : {}) } });

    const updated = (await loadTask(tx, id))!;
    if (isOpen(input.status)) await replanReminders(tx, reminderTarget(updated), now);
    else await cancelPendingReminders(tx, id);
    if (completing) await onOccurrenceCompleted(tx, updated, await today(tx, p.orgId, now), now);
    return toTaskDto(updated, await today(tx, p.orgId, now));
  });
}

export async function setParticipants(ctx: AppContext, p: Principal, id: string, input: z.output<typeof setParticipantsSchema>): Promise<TaskDto> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const task = await lockTask(tx, p, id, input.version);
    if (!policy.canEditTask(p, task)) throw forbidden();
    if (task.archivedAt) throw invalid('Archived tasks are read-only. Unarchive first.');
    const next = [...new Set(input.participantIds)].filter((x) => x !== task.ownerPersonId);
    await assertActivePeople(tx, p.orgId, next);

    const added = next.filter((x) => !task.participantIds.includes(x));
    const removed = task.participantIds.filter((x) => !next.includes(x));
    if (added.length === 0 && removed.length === 0) return toTaskDto(task, await today(tx, p.orgId, now));

    if (removed.length) await tx.delete(taskParticipants).where(and(eq(taskParticipants.taskId, id), inArray(taskParticipants.personId, removed)));
    if (added.length) await tx.insert(taskParticipants).values(added.map((personId) => ({ taskId: id, personId, addedAt: now })));
    await bump(tx, id, {}, now);
    await recordAudit(tx, { orgId: p.orgId, entityType: 'task', entityId: id, type: 'task.participants_changed', actor: actorOf(p), data: { added, removed } });
    await notifyAssigned(tx, task, added, p.personId, now);
    const updated = (await loadTask(tx, id))!;
    await replanReminders(tx, reminderTarget(updated), now);
    return toTaskDto(updated, await today(tx, p.orgId, now));
  });
}

export async function setArchived(ctx: AppContext, p: Principal, id: string, version: number, archived: boolean): Promise<TaskDto> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const task = await lockTask(tx, p, id, version);
    if (!policy.canEditTask(p, task)) throw forbidden();
    if ((task.archivedAt !== null) === archived) throw invalid(archived ? 'Already archived' : 'Not archived');
    await bump(tx, id, { archivedAt: archived ? now : null }, now);
    await recordAudit(tx, { orgId: p.orgId, entityType: 'task', entityId: id, type: archived ? 'task.archived' : 'task.unarchived', actor: actorOf(p) });
    const updated = (await loadTask(tx, id))!;
    if (archived) await cancelPendingReminders(tx, id);
    else await replanReminders(tx, reminderTarget(updated), now);
    return reload(tx, id, now);
  });
}

// ---------------- Queries ----------------

export async function listTasks(ctx: AppContext, p: Principal, q: z.output<typeof listTasksQuerySchema>): Promise<TaskDto[]> {
  if (!policy.canListTasks(p)) throw forbidden();
  const now = ctx.now();
  const todayDate = await today(ctx.db, p.orgId, now);
  const weekEnd = endOfWeek(todayDate);

  const involvesMe = or(
    eq(tasks.ownerPersonId, p.personId),
    exists(
      ctx.db
        .select({ one: sql`1` })
        .from(taskParticipants)
        .where(and(eq(taskParticipants.taskId, tasks.id), eq(taskParticipants.personId, p.personId))),
    ),
  )!;

  const where: SQL[] = [eq(tasks.orgId, p.orgId)];
  if (!q.includeArchived) where.push(isNull(tasks.archivedAt));
  if (q.mine || !policy.canListOrgTasks(p)) where.push(involvesMe);
  if (q.ownerPersonId) where.push(eq(tasks.ownerPersonId, q.ownerPersonId));
  if (q.status) where.push(eq(tasks.status, q.status));
  else if (q.view !== 'all') where.push(inArray(tasks.status, [...OPEN_STATUSES]));

  switch (q.view) {
    case 'today':
      where.push(eq(tasks.dueDate, todayDate));
      break;
    case 'week':
      where.push(sql`${tasks.dueDate} between ${todayDate} and ${weekEnd}`);
      break;
    case 'overdue':
      where.push(lt(tasks.dueDate, todayDate));
      break;
    case 'future':
      where.push(gt(tasks.dueDate, weekEnd));
      break;
    case 'undated':
      where.push(isNull(tasks.dueDate));
      break;
    case 'all':
      break;
  }

  const rows = await ctx.db
    .select()
    .from(tasks)
    .where(and(...where))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, asc(tasks.createdAt))
    .limit(500);
  const parts = await participantsOf(ctx.db, rows.map((r) => r.id));
  return rows.map((r) => toTaskDto({ ...r, participantIds: parts.get(r.id) ?? [] }, todayDate));
}

export async function getTaskDetail(ctx: AppContext, p: Principal, id: string): Promise<TaskDetailDto> {
  const task = await loadTask(ctx.db, id);
  if (!task || !policy.canViewTask(p, task)) throw notFound('Task');
  const dto = toTaskDto(task, await today(ctx.db, p.orgId, ctx.now()));
  const events = await listAudit(ctx.db, 'task', id);
  const ids = [task.ownerPersonId, ...task.participantIds, ...events.flatMap((e) => (e.actorPersonId ? [e.actorPersonId] : []))];
  for (const e of events) if (e.type === 'task.owner_changed') ids.push(String(e.data.from), String(e.data.to));
  const named = await ctx.db
    .select({ id: people.id, displayName: people.displayName, jobTitle: people.jobTitle })
    .from(people)
    .where(and(eq(people.orgId, p.orgId), inArray(people.id, [...new Set(ids)])));
  return {
    ...dto,
    allowedStatuses: policy.canChangeStatus(p, task) ? allowedTransitions(task.status, task.archivedAt !== null) : [],
    canEdit: policy.canEditTask(p, task),
    events,
    names: Object.fromEntries(named.map((n) => [n.id, n.displayName])),
    jobTitles: Object.fromEntries(named.flatMap((n) => (n.jobTitle ? [[n.id, n.jobTitle]] : []))),
    documents: await documentsOfTask(ctx.db, id),
  };
}
