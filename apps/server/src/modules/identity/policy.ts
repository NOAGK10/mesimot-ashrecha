import type { Principal } from './principal';

/**
 * Authorization rules. Every rule is evaluated on the server; the web client only mirrors results it receives.
 *
 *  manager — sees and edits everything (including private tasks); manages people, recurrence, documents, settings.
 *  member  — permanent staff: sees organisation tasks and the private tasks they are part of; changes status
 *            on tasks they own or participate in; creates tasks only with themselves as owner.
 *  guest   — like a member for visibility (organisation tasks are for everyone, C-26); cannot create tasks.
 *  link    — magic-link visitor: one task only.
 *
 * Task visibility (APPROVED, docs/DECISIONS.md C-26):
 *  org     — everyone who signs in.
 *  private — its creator, owner and participants, and managers.
 * The creator of a task (and managers) may edit and delete it.
 */
export interface TaskFacts {
  id: string;
  orgId: string;
  ownerPersonId: string;
  participantIds: readonly string[];
  visibility: 'org' | 'private';
  createdByPersonId: string | null;
}

const isInvolved = (p: Principal, t: TaskFacts) =>
  t.ownerPersonId === p.personId || t.participantIds.includes(p.personId);
const isCreator = (p: Principal, t: TaskFacts) => t.createdByPersonId === p.personId;

export const policy = {
  isManager: (p: Principal) => p.access === 'manager',

  canViewTask(p: Principal, t: TaskFacts): boolean {
    if (t.orgId !== p.orgId) return false;
    if (p.access === 'manager') return true;
    if (p.access === 'link') return p.scopeTaskId === t.id;
    if (t.visibility === 'org') return true;
    return isInvolved(p, t) || isCreator(p, t);
  },

  /** Title, description, owner, due date, participants, category, visibility, archive. */
  canEditTask(p: Principal, t: TaskFacts): boolean {
    if (t.orgId !== p.orgId || p.access === 'link') return false;
    return p.access === 'manager' || isCreator(p, t);
  },

  canDeleteTask(p: Principal, t: TaskFacts): boolean {
    return policy.canEditTask(p, t);
  },

  canChangeStatus(p: Principal, t: TaskFacts): boolean {
    if (!policy.canViewTask(p, t)) return false;
    return p.access === 'manager' || isInvolved(p, t);
  },

  canCreateTask: (p: Principal) => p.access === 'manager' || p.access === 'member',
  /** Members may only create (or hand over) tasks they own themselves. */
  canCreateTaskOwnedBy: (p: Principal, ownerPersonId: string) =>
    p.access === 'manager' || (p.access === 'member' && ownerPersonId === p.personId),
  canListTasks: (p: Principal) => p.access !== 'link',
  /** Sees every task including private ones. */
  canListAllTasks: (p: Principal) => p.access === 'manager',
  canManagePeople: (p: Principal) => p.access === 'manager',
  canListPeople: (p: Principal) => p.access !== 'link',
  canManageRecurrence: (p: Principal) => p.access === 'manager',
  canViewOperations: (p: Principal) => p.access === 'manager',
};
