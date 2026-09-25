import type { Principal } from './principal';

/**
 * Authorization rules. Every rule is evaluated on the server; the web client only mirrors results it receives.
 *
 *  manager — sees and edits everything; manages people, recurrence, documents, settings.
 *  member  — permanent staff (APPROVED, docs/DECISIONS.md C-9): sees all organisation tasks and every
 *            personal page; changes status only on tasks they own or participate in; creates tasks
 *            only with themselves as owner.
 *  guest   — sees only tasks they are involved in; changes their status.
 *  link    — magic-link visitor: one task only.
 */
export interface TaskFacts {
  id: string;
  orgId: string;
  ownerPersonId: string;
  participantIds: readonly string[];
}

const isInvolved = (p: Principal, t: TaskFacts) =>
  t.ownerPersonId === p.personId || t.participantIds.includes(p.personId);

const seesWholeOrg = (p: Principal) => p.access === 'manager' || p.access === 'member';

export const policy = {
  isManager: (p: Principal) => p.access === 'manager',

  canViewTask(p: Principal, t: TaskFacts): boolean {
    if (t.orgId !== p.orgId) return false;
    if (seesWholeOrg(p)) return true;
    if (p.access === 'link') return p.scopeTaskId === t.id;
    return isInvolved(p, t);
  },

  /** Title, description, owner, due date, participants, archive. */
  canEditTask(p: Principal, t: TaskFacts): boolean {
    return p.access === 'manager' && t.orgId === p.orgId;
  },

  canChangeStatus(p: Principal, t: TaskFacts): boolean {
    if (!policy.canViewTask(p, t)) return false;
    return p.access === 'manager' || isInvolved(p, t);
  },

  canCreateTask: (p: Principal) => seesWholeOrg(p),
  /** Members may only create tasks they own themselves. */
  canCreateTaskOwnedBy: (p: Principal, ownerPersonId: string) =>
    p.access === 'manager' || (p.access === 'member' && ownerPersonId === p.personId),
  canListTasks: (p: Principal) => p.access !== 'link',
  canListOrgTasks: (p: Principal) => seesWholeOrg(p),
  canManagePeople: (p: Principal) => p.access === 'manager',
  canListPeople: (p: Principal) => p.access !== 'link',
  canManageRecurrence: (p: Principal) => p.access === 'manager',
  canViewOperations: (p: Principal) => p.access === 'manager',
};
