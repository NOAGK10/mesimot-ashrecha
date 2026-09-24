import type { TaskStatus } from '@org/shared';
import { OPEN_STATUSES } from '@org/shared';
import { invalid } from '../../lib/errors';

/**
 * Allowed status transitions (PROPOSED — see docs/DECISIONS.md, D5).
 * Archiving is not a status; it is the separate `archived_at` flag.
 */
const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  new: ['in_progress', 'waiting', 'blocked', 'completed', 'cancelled'],
  in_progress: ['waiting', 'blocked', 'completed', 'cancelled'],
  // waiting = depends on someone/something else; blocked = there is a problem that stops the work.
  waiting: ['in_progress', 'blocked', 'completed', 'cancelled'],
  blocked: ['in_progress', 'waiting', 'completed', 'cancelled'],
  completed: ['in_progress'], // reopen
  cancelled: ['new'], // restore
};

export function allowedTransitions(from: TaskStatus, archived: boolean): TaskStatus[] {
  return archived ? [] : [...TRANSITIONS[from]];
}

export function assertTransition(from: TaskStatus, to: TaskStatus, archived: boolean): void {
  if (archived) throw invalid('Archived tasks cannot change status. Unarchive first.');
  if (!TRANSITIONS[from].includes(to)) throw invalid(`Cannot move a task from "${from}" to "${to}"`);
}

export function isOpen(status: TaskStatus): boolean {
  return OPEN_STATUSES.includes(status);
}
