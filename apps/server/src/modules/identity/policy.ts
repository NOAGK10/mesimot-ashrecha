import type { Principal } from './principal';

/**
 * Authorization rules (PROPOSED — see docs/DECISIONS.md, D2/D3).
 * Every rule is evaluated on the server; the web client only mirrors results it receives.
 */
export interface TaskFacts {
  id: string;
  orgId: string;
  ownerPersonId: string;
  participantIds: readonly string[];
}

const isInvolved = (p: Principal, t: TaskFacts) =>
  t.ownerPersonId === p.personId || t.participantIds.includes(p.personId);

export const policy = {
  isManager: (p: Principal) => p.access === 'manager',

  canViewTask(p: Principal, t: TaskFacts): boolean {
    if (t.orgId !== p.orgId) return false;
    if (p.access === 'manager') return true;
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

  canCreateTask: (p: Principal) => p.access === 'manager',
  canListTasks: (p: Principal) => p.access !== 'link',
  canListOrgTasks: (p: Principal) => p.access === 'manager',
  canManagePeople: (p: Principal) => p.access === 'manager',
  canListPeople: (p: Principal) => p.access !== 'link',
  canManageRecurrence: (p: Principal) => p.access === 'manager',
  canViewOperations: (p: Principal) => p.access === 'manager',
};
