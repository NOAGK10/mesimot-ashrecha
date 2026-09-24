import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { notifications, organizations } from '../../db/schema';
import type { IsoDate } from '../../lib/dates';
import { planDateReminders } from './plan';

/**
 * Called inside task-mutating transactions. Writing notification rows here (rather than sending mail)
 * keeps delivery out of the request path: the worker picks them up later (transactional outbox).
 */

export interface ReminderTarget {
  id: string;
  orgId: string;
  dueDate: IsoDate | null;
  ownerPersonId: string;
  participantIds: readonly string[];
  open: boolean;
}

/** Drops unsent date reminders and plans them again from the task's current state. */
export async function replanReminders(tx: Db, task: ReminderTarget, now: Date): Promise<void> {
  await tx
    .delete(notifications)
    .where(
      and(
        eq(notifications.taskId, task.id),
        eq(notifications.status, 'pending'),
        inArray(notifications.kind, ['due_soon', 'due_today', 'overdue']),
      ),
    );
  if (!task.open || !task.dueDate) return;

  const [org] = await tx.select().from(organizations).where(eq(organizations.id, task.orgId));
  if (!org) return;
  const planned = planDateReminders(task.dueDate, [task.ownerPersonId, ...task.participantIds], org, now);
  if (planned.length === 0) return;
  await tx
    .insert(notifications)
    .values(planned.map((r) => ({ orgId: task.orgId, taskId: task.id, ...r })))
    .onConflictDoNothing();
}

/** Tells newly involved people about a task. The person who made the change is not notified. */
export async function notifyAssigned(
  tx: Db,
  task: { id: string; orgId: string },
  personIds: readonly string[],
  actorPersonId: string | null,
  now: Date,
): Promise<void> {
  const recipients = [...new Set(personIds)].filter((id) => id !== actorPersonId);
  if (recipients.length === 0) return;
  await tx
    .insert(notifications)
    .values(recipients.map((personId) => ({ orgId: task.orgId, taskId: task.id, personId, kind: 'assigned' as const, sendAt: now })))
    .onConflictDoNothing();
}

export async function cancelPendingReminders(tx: Db, taskId: string): Promise<void> {
  await tx.delete(notifications).where(and(eq(notifications.taskId, taskId), eq(notifications.status, 'pending')));
}
