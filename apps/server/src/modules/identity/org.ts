import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { OrganizationDto, updateOrganizationSchema } from '@org/shared';
import { OPEN_STATUSES } from '@org/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db/client';
import { organizations, tasks } from '../../db/schema';
import { forbidden, notFound } from '../../lib/errors';
import { replanReminders } from '../notifications/scheduling';
import { participantsOf } from '../tasks/task-store';
import { policy } from './policy';
import type { Principal } from './principal';

export type Organization = typeof organizations.$inferSelect;

export async function getOrg(db: Db, orgId: string): Promise<Organization> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw notFound('Organization');
  return org;
}

const toDto = (o: Organization): OrganizationDto => ({
  id: o.id,
  name: o.name,
  timezone: o.timezone,
  reminderHour: o.reminderHour,
  dueSoonDays: o.dueSoonDays,
});

export async function getOrganizationSettings(ctx: AppContext, p: Principal): Promise<OrganizationDto> {
  if (!policy.isManager(p)) throw forbidden();
  return toDto(await getOrg(ctx.db, p.orgId));
}

/** Managers edit organisation settings. Changing reminder timing re-plans pending reminders of open tasks. */
export async function updateOrganizationSettings(
  ctx: AppContext,
  p: Principal,
  input: z.output<typeof updateOrganizationSchema>,
): Promise<OrganizationDto> {
  if (!policy.isManager(p)) throw forbidden();
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const before = await getOrg(tx, p.orgId);
    const [org] = await tx.update(organizations).set(input).where(eq(organizations.id, p.orgId)).returning();
    const timingChanged =
      (input.reminderHour !== undefined && input.reminderHour !== before.reminderHour) ||
      (input.dueSoonDays !== undefined && input.dueSoonDays !== before.dueSoonDays);
    if (timingChanged) {
      const open = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.orgId, p.orgId), isNull(tasks.archivedAt), isNotNull(tasks.dueDate), inArray(tasks.status, [...OPEN_STATUSES])));
      const parts = await participantsOf(tx, open.map((t) => t.id));
      for (const t of open) await replanReminders(tx, { ...t, participantIds: parts.get(t.id) ?? [], open: true }, now);
    }
    return toDto(org!);
  });
}
