import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { organizations } from '../../db/schema';
import { notFound } from '../../lib/errors';

export type Organization = typeof organizations.$inferSelect;

export async function getOrg(db: Db, orgId: string): Promise<Organization> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw notFound('Organization');
  return org;
}
