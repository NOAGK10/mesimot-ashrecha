import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { TaskDto } from '@org/shared';
import type { Db } from '../../db/client';
import { people, taskParticipants, tasks } from '../../db/schema';
import { invalid } from '../../lib/errors';
import type { IsoDate } from '../../lib/dates';
import { isOpen } from './lifecycle';

/**
 * Low-level persistence for tasks, shared by the task service and the recurrence module.
 * This is the only place that inserts rows into `tasks`; callers own authorization and audit.
 */

export type TaskRow = typeof tasks.$inferSelect;
export interface TaskWithParticipants extends TaskRow {
  participantIds: string[];
}

export async function participantsOf(db: Db, taskIds: readonly string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>(taskIds.map((id) => [id, []]));
  if (taskIds.length === 0) return map;
  const rows = await db
    .select({ taskId: taskParticipants.taskId, personId: taskParticipants.personId })
    .from(taskParticipants)
    .where(inArray(taskParticipants.taskId, [...taskIds]));
  for (const r of rows) map.get(r.taskId)?.push(r.personId);
  return map;
}

export async function loadTask(db: Db, id: string, forUpdate = false): Promise<TaskWithParticipants | null> {
  const q = db.select().from(tasks).where(eq(tasks.id, id));
  const [row] = forUpdate ? await q.for('update') : await q;
  if (!row) return null;
  const participants = await participantsOf(db, [id]);
  return { ...row, participantIds: participants.get(id) ?? [] };
}

/** Ensures every referenced person exists, is active and belongs to the organisation. */
export async function assertActivePeople(db: Db, orgId: string, personIds: readonly string[]): Promise<void> {
  const unique = [...new Set(personIds)];
  if (unique.length === 0) return;
  const found = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.orgId, orgId), inArray(people.id, unique), isNull(people.deactivatedAt)));
  if (found.length !== unique.length) throw invalid('One or more people are unknown or inactive');
}

export interface NewTask {
  orgId: string;
  title: string;
  description: string;
  ownerPersonId: string;
  dueDate: IsoDate | null;
  participantIds: readonly string[];
  createdByPersonId: string | null;
  recurrence?: { definitionId: string; occurrenceDate: IsoDate };
}

/**
 * Inserts a task and its participants. For recurring occurrences the (definition, date) unique index
 * makes this idempotent: returns null when that occurrence already exists.
 */
export async function insertTask(tx: Db, t: NewTask, now: Date): Promise<TaskWithParticipants | null> {
  const participantIds = [...new Set(t.participantIds)].filter((id) => id !== t.ownerPersonId);
  const [row] = await tx
    .insert(tasks)
    .values({
      orgId: t.orgId,
      title: t.title,
      description: t.description,
      ownerPersonId: t.ownerPersonId,
      dueDate: t.dueDate,
      createdByPersonId: t.createdByPersonId,
      recurrenceDefinitionId: t.recurrence?.definitionId ?? null,
      occurrenceDate: t.recurrence?.occurrenceDate ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return null;
  if (participantIds.length) {
    await tx.insert(taskParticipants).values(participantIds.map((personId) => ({ taskId: row.id, personId, addedAt: now })));
  }
  return { ...row, participantIds };
}

export function toTaskDto(t: TaskWithParticipants, today: IsoDate): TaskDto {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    ownerPersonId: t.ownerPersonId,
    dueDate: t.dueDate,
    recurrenceDefinitionId: t.recurrenceDefinitionId,
    occurrenceDate: t.occurrenceDate,
    participantIds: t.participantIds,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    completedAt: t.completedAt?.toISOString() ?? null,
    archivedAt: t.archivedAt?.toISOString() ?? null,
    version: t.version,
    isOverdue: t.dueDate !== null && t.dueDate < today && isOpen(t.status) && t.archivedAt === null,
  };
}
