import { and, asc, eq } from 'drizzle-orm';
import type { TaskCategoryDto } from '@org/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db/client';
import { taskCategories } from '../../db/schema';
import { conflict, forbidden, invalid, notFound } from '../../lib/errors';
import { policy } from '../identity/policy';
import type { Principal } from '../identity/principal';

/** Task categories (APPROVED, docs/DECISIONS.md C-22): managers define them, everyone picks from the list. */

export async function listTaskCategories(ctx: AppContext, p: Principal): Promise<TaskCategoryDto[]> {
  if (p.access === 'link') throw forbidden();
  return ctx.db
    .select({ id: taskCategories.id, name: taskCategories.name, color: taskCategories.color })
    .from(taskCategories)
    .where(eq(taskCategories.orgId, p.orgId))
    .orderBy(asc(taskCategories.name));
}

/** Ensures a category id belongs to the organisation (null/undefined = no category). */
export async function assertTaskCategory(db: Db, orgId: string, categoryId: string | null | undefined): Promise<void> {
  if (!categoryId) return;
  const [c] = await db.select({ orgId: taskCategories.orgId }).from(taskCategories).where(eq(taskCategories.id, categoryId));
  if (!c || c.orgId !== orgId) throw invalid('Unknown category');
}

async function assertNameFree(db: Db, orgId: string, name: string, exceptId?: string) {
  const [dup] = await db
    .select({ id: taskCategories.id })
    .from(taskCategories)
    .where(and(eq(taskCategories.orgId, orgId), eq(taskCategories.name, name)));
  if (dup && dup.id !== exceptId) throw conflict('A category with this name already exists');
}

export async function createTaskCategory(ctx: AppContext, p: Principal, input: { name: string; color: string }): Promise<TaskCategoryDto> {
  if (!policy.isManager(p)) throw forbidden();
  await assertNameFree(ctx.db, p.orgId, input.name);
  const [row] = await ctx.db.insert(taskCategories).values({ orgId: p.orgId, ...input }).returning();
  return { id: row!.id, name: row!.name, color: row!.color };
}

export async function updateTaskCategory(ctx: AppContext, p: Principal, id: string, input: { name: string; color: string }): Promise<TaskCategoryDto> {
  if (!policy.isManager(p)) throw forbidden();
  await assertNameFree(ctx.db, p.orgId, input.name, id);
  const [row] = await ctx.db
    .update(taskCategories)
    .set(input)
    .where(and(eq(taskCategories.id, id), eq(taskCategories.orgId, p.orgId)))
    .returning();
  if (!row) throw notFound('Category');
  return { id: row.id, name: row.name, color: row.color };
}

/** Deleting a category keeps its tasks; they become uncategorised. */
export async function deleteTaskCategory(ctx: AppContext, p: Principal, id: string): Promise<void> {
  if (!policy.isManager(p)) throw forbidden();
  await ctx.db.delete(taskCategories).where(and(eq(taskCategories.id, id), eq(taskCategories.orgId, p.orgId)));
}
