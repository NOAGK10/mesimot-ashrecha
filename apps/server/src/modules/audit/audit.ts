import { and, asc, eq } from 'drizzle-orm';
import type { AuditEventDto } from '@org/shared';
import type { Db } from '../../db/client';
import { auditEvents } from '../../db/schema';
import type { Actor } from '../identity/principal';

export type AuditEntity = 'task' | 'recurrence' | 'person';

/** Must be called inside the transaction that performs the change it describes. */
export async function recordAudit(
  tx: Db,
  e: { orgId: string; entityType: AuditEntity; entityId: string; type: string; actor: Actor; data?: Record<string, unknown> },
): Promise<void> {
  await tx.insert(auditEvents).values({
    orgId: e.orgId,
    entityType: e.entityType,
    entityId: e.entityId,
    type: e.type,
    actorType: e.actor.type,
    actorPersonId: e.actor.type === 'person' ? e.actor.personId : null,
    via: e.actor.via,
    data: e.data ?? {},
  });
}

export async function listAudit(db: Db, entityType: AuditEntity, entityId: string): Promise<AuditEventDto[]> {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityType, entityType), eq(auditEvents.entityId, entityId)))
    .orderBy(asc(auditEvents.id));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    actorType: r.actorType,
    actorPersonId: r.actorPersonId,
    data: r.data,
    createdAt: r.createdAt.toISOString(),
  }));
}
