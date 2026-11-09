import { asc, eq } from 'drizzle-orm';
import type { SheetContactField, SheetContactsDto } from '@org/shared';
import type { AppContext } from '../../context';
import { organizations, sheetContacts } from '../../db/schema';
import { AppError, forbidden, invalid } from '../../lib/errors';
import { parseGoogleUrl } from '../google/gateway';
import { mapSheetRows, normHeader, readSheetRows, sheetLink } from '../google/sheet-table';
import { policy } from '../identity/policy';
import { contactKey, listContactCategories } from './category-service';
import type { Principal } from '../identity/principal';

/**
 * Contacts from a Google Sheet a manager connects (name, phone, e-mail, responsible, address).
 * Works like the institutions list: the sheet is the source, every update replaces the list, it updates
 * itself when opened after STALE_MS, managers and members see it, only managers connect the sheet.
 */

const STALE_MS = 10 * 60 * 1000;

/** Phone and e-mail first ("טלפון האחראי" is a phone), then "responsible" before the name ("שם האחראי"). */
export function contactFieldOf(header: string): SheetContactField | null {
  const h = normHeader(header);
  if (!h) return null;
  if (/מייל|דוא ל|דואל|אימייל|email|e mail|mail/.test(h)) return 'email';
  if (/טלפון|טל |^טל$|נייד|פלאפון|סלולרי|phone|mobile/.test(h)) return 'phone';
  if (/אחראי|אחראית|מטפל|מטפלת|responsible|owner/.test(h)) return 'responsible';
  if (/כתובת|רחוב|עיר|יישוב|ישוב|address|city/.test(h)) return 'address';
  if (/שם|איש קשר|name|contact/.test(h)) return 'name';
  return null;
}

export const mapContactsSheet = (raw: string[][]) =>
  mapSheetRows(raw, { fieldOf: contactFieldOf, order: ['name', 'phone', 'email', 'responsible', 'address'], required: 'name' });


async function sync(ctx: AppContext, orgId: string): Promise<void> {
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org?.contactsSheetId) return;
  try {
    const { rows, unmatched } = mapContactsSheet(await readSheetRows(ctx, orgId, org.contactsSheetId, org.contactsSheetBy, org.contactsSheetGid));
    await ctx.db.transaction(async (tx) => {
      await tx.delete(sheetContacts).where(eq(sheetContacts.orgId, orgId));
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(sheetContacts).values(rows.slice(i, i + 500).map((r, j) => ({ ...r, orgId, position: i + j })));
      }
      await tx.update(organizations).set({ contactsSyncedAt: ctx.now(), contactsSyncError: null, contactsUnmatched: unmatched }).where(eq(organizations.id, orgId));
    });
  } catch (e) {
    const message = e instanceof AppError ? e.message : 'The sheet could not be read';
    await ctx.db.update(organizations).set({ contactsSyncedAt: ctx.now(), contactsSyncError: message }).where(eq(organizations.id, orgId));
    if (e instanceof AppError) throw e;
    ctx.log.warn({ err: e }, 'contacts sync failed');
  }
}

export async function getSheetContacts(ctx: AppContext, p: Principal): Promise<SheetContactsDto> {
  if (!policy.canCreateTask(p)) throw forbidden();
  let [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, p.orgId));
  const stale = !org?.contactsSyncedAt || ctx.now().getTime() - org.contactsSyncedAt.getTime() > STALE_MS;
  if (org?.contactsSheetId && stale) {
    await sync(ctx, p.orgId).catch(() => undefined);
    [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, p.orgId));
  }
  const rows = await ctx.db.select().from(sheetContacts).where(eq(sheetContacts.orgId, p.orgId)).orderBy(asc(sheetContacts.position));
  const { categories, members } = await listContactCategories(ctx, p.orgId);
  return {
    categories,
    sheetUrl: org?.contactsSheetId ? sheetLink(org.contactsSheetId, org.contactsSheetGid) : null,
    syncedAt: org?.contactsSyncedAt?.toISOString() ?? null,
    syncError: org?.contactsSyncError ?? null,
    unmatchedColumns: org?.contactsUnmatched ?? [],
    canManage: policy.isManager(p),
    items: rows.map((r) => {
      const key = contactKey(r.name, r.phone);
      return { id: r.id, key, categoryIds: members.get(key) ?? [], name: r.name, phone: r.phone, email: r.email, responsible: r.responsible, address: r.address };
    }),
  };
}

export async function setContactsSheet(ctx: AppContext, p: Principal, url: string): Promise<SheetContactsDto> {
  if (!policy.isManager(p)) throw forbidden();
  const parsed = parseGoogleUrl(url);
  if (!parsed || parsed.kind !== 'google_sheet') throw invalid('This is not a Google Sheets link');
  if (mapContactsSheet(await readSheetRows(ctx, p.orgId, parsed.fileId, p.personId, parsed.gid)).rows.length === 0) {
    throw invalid('No rows with a name were found in the first tab of the sheet');
  }
  await ctx.db
    .update(organizations)
    .set({ contactsSheetId: parsed.fileId, contactsSheetGid: parsed.gid, contactsSheetBy: p.personId, contactsSyncedAt: null, contactsSyncError: null })
    .where(eq(organizations.id, p.orgId));
  await sync(ctx, p.orgId);
  return getSheetContacts(ctx, p);
}

export async function refreshSheetContacts(ctx: AppContext, p: Principal): Promise<SheetContactsDto> {
  if (!policy.isManager(p)) throw forbidden();
  await sync(ctx, p.orgId);
  return getSheetContacts(ctx, p);
}
