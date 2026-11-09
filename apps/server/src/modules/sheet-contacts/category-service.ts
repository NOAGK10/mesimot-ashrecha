import { and, asc, eq, inArray } from 'drizzle-orm';
import type { ContactCategoryDto } from '@org/shared';
import type { AppContext } from '../../context';
import { contactCategories, contactCategoryMembers, sheetContacts } from '../../db/schema';
import { conflict, forbidden, notFound } from '../../lib/errors';
import { policy } from '../identity/policy';
import type { Principal } from '../identity/principal';

/** Contact categories: managers create them and decide who is in each; the team filters by them. */

/** Name + phone digits, lower-cased and trimmed – the same contact keeps its categories across updates. */
export const contactKey = (name: string, phone: string) => `${name.trim().replace(/\s+/g, ' ').toLowerCase()}|${phone.replace(/\D/g, '')}`;

export async function listContactCategories(ctx: AppContext, orgId: string): Promise<{ categories: ContactCategoryDto[]; members: Map<string, string[]> }> {
  const categories = await ctx.db
    .select({ id: contactCategories.id, name: contactCategories.name, color: contactCategories.color })
    .from(contactCategories)
    .where(eq(contactCategories.orgId, orgId))
    .orderBy(asc(contactCategories.createdAt));
  const rows = categories.length
    ? await ctx.db.select().from(contactCategoryMembers).where(inArray(contactCategoryMembers.categoryId, categories.map((c) => c.id)))
    : [];
  const members = new Map<string, string[]>(); // contact key → category ids
  for (const r of rows) members.set(r.contactKey, [...(members.get(r.contactKey) ?? []), r.categoryId]);
  return { categories, members };
}

async function own(ctx: AppContext, p: Principal, id: string) {
  if (!policy.isManager(p)) throw forbidden();
  const [c] = await ctx.db.select().from(contactCategories).where(and(eq(contactCategories.id, id), eq(contactCategories.orgId, p.orgId)));
  if (!c) throw notFound('Category');
  return c;
}

async function assertNameFree(ctx: AppContext, orgId: string, name: string, exceptId?: string) {
  const [dup] = await ctx.db.select({ id: contactCategories.id }).from(contactCategories).where(and(eq(contactCategories.orgId, orgId), eq(contactCategories.name, name)));
  if (dup && dup.id !== exceptId) throw conflict('A category with this name already exists');
}

export async function createContactCategory(ctx: AppContext, p: Principal, input: { name: string; color: string }): Promise<ContactCategoryDto> {
  if (!policy.isManager(p)) throw forbidden();
  await assertNameFree(ctx, p.orgId, input.name);
  const [row] = await ctx.db.insert(contactCategories).values({ ...input, orgId: p.orgId, createdAt: ctx.now() }).returning();
  return { id: row!.id, name: row!.name, color: row!.color };
}

export async function updateContactCategory(ctx: AppContext, p: Principal, id: string, input: { name: string; color: string }): Promise<void> {
  await own(ctx, p, id);
  await assertNameFree(ctx, p.orgId, input.name, id);
  await ctx.db.update(contactCategories).set(input).where(eq(contactCategories.id, id));
}

/** Deleting a category keeps the contacts (they come from the sheet); only the grouping goes. */
export async function deleteContactCategory(ctx: AppContext, p: Principal, id: string): Promise<void> {
  await own(ctx, p, id);
  await ctx.db.delete(contactCategories).where(eq(contactCategories.id, id));
}

/**
 * Replaces who is in the category among the contacts now in the sheet. Members whose row is missing from
 * the sheet right now are kept, so a contact that comes back (or was briefly removed) keeps its category.
 */
export async function setContactCategoryMembers(ctx: AppContext, p: Principal, id: string, keys: string[]): Promise<void> {
  await own(ctx, p, id);
  const current = new Set(
    (await ctx.db.select({ name: sheetContacts.name, phone: sheetContacts.phone }).from(sheetContacts).where(eq(sheetContacts.orgId, p.orgId))).map((r) =>
      contactKey(r.name, r.phone),
    ),
  );
  const existing = await ctx.db.select({ key: contactCategoryMembers.contactKey }).from(contactCategoryMembers).where(eq(contactCategoryMembers.categoryId, id));
  const unique = [...new Set([...keys, ...existing.map((e) => e.key).filter((k) => !current.has(k))])];
  await ctx.db.transaction(async (tx) => {
    await tx.delete(contactCategoryMembers).where(eq(contactCategoryMembers.categoryId, id));
    for (let i = 0; i < unique.length; i += 1000) {
      await tx.insert(contactCategoryMembers).values(unique.slice(i, i + 1000).map((contactKey) => ({ categoryId: id, contactKey })));
    }
  });
}
