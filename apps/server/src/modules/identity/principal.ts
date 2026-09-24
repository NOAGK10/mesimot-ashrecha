/** The authenticated caller, resolved server-side from the session cookie. */
export interface Principal {
  personId: string;
  orgId: string;
  access: 'manager' | 'guest' | 'link';
  /** Only for magic-link sessions: the single task this caller may see. */
  scopeTaskId: string | null;
  via: 'session' | 'magic_link';
}

/** Who performed a mutation, for the audit log. */
export type Actor =
  | { type: 'person'; personId: string; via: 'session' | 'magic_link' }
  | { type: 'system'; via: 'worker' };

export const SYSTEM_ACTOR: Actor = { type: 'system', via: 'worker' };

export function actorOf(p: Principal): Actor {
  return { type: 'person', personId: p.personId, via: p.via };
}
