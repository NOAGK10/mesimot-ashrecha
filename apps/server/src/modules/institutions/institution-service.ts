import { asc, eq } from 'drizzle-orm';
import type { InstitutionsDto } from '@org/shared';
import type { AppContext } from '../../context';
import { institutions, organizations } from '../../db/schema';
import { AppError, forbidden, invalid } from '../../lib/errors';
import { parseGoogleUrl } from '../google/gateway';
import { readSheetRows as readSheet } from '../google/sheet-table';
import { policy } from '../identity/policy';
import type { Principal } from '../identity/principal';
import { mapSheet } from './columns';

/**
 * The institutions list (yeshivas / kollels) comes from a Google Sheet a manager connects.
 * The sheet is the source: every update replaces the list with what is in it now. Managers and members
 * see the list; guests do not. It updates itself when opened if the last update is older than STALE_MS.
 */

const STALE_MS = 10 * 60 * 1000;

function assertCanView(p: Principal) {
  if (!policy.canCreateTask(p)) throw forbidden();
}

const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

/** Replaces the list with the sheet's rows. On failure the old list stays and the error is recorded. */
async function syncFromSheet(ctx: AppContext, orgId: string): Promise<void> {
  const [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org?.institutionsSheetId) return;
  try {
    const raw = await readSheet(ctx, orgId, org.institutionsSheetId, org.institutionsSheetBy);
    const { rows, unmatched } = mapSheet(raw);
    await ctx.db.transaction(async (tx) => {
      await tx.delete(institutions).where(eq(institutions.orgId, orgId));
      if (rows.length) {
        for (let i = 0; i < rows.length; i += 500) {
          await tx.insert(institutions).values(rows.slice(i, i + 500).map((r, j) => ({ ...r, orgId, position: i + j })));
        }
      }
      await tx
        .update(organizations)
        .set({ institutionsSyncedAt: ctx.now(), institutionsSyncError: null, institutionsUnmatched: unmatched })
        .where(eq(organizations.id, orgId));
    });
  } catch (e) {
    const message = e instanceof AppError ? e.message : 'The sheet could not be read';
    await ctx.db.update(organizations).set({ institutionsSyncedAt: ctx.now(), institutionsSyncError: message }).where(eq(organizations.id, orgId));
    if (e instanceof AppError) throw e;
    ctx.log.warn({ err: e }, 'institutions sync failed');
  }
}

export async function getInstitutions(ctx: AppContext, p: Principal, opts: { refresh?: boolean } = {}): Promise<InstitutionsDto> {
  assertCanView(p);
  let [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, p.orgId));
  const stale = !org?.institutionsSyncedAt || ctx.now().getTime() - org.institutionsSyncedAt.getTime() > STALE_MS;
  if (org?.institutionsSheetId && (opts.refresh || stale)) {
    await syncFromSheet(ctx, p.orgId).catch(() => undefined);
    [org] = await ctx.db.select().from(organizations).where(eq(organizations.id, p.orgId));
  }
  const rows = await ctx.db.select().from(institutions).where(eq(institutions.orgId, p.orgId)).orderBy(asc(institutions.position));
  return {
    sheetUrl: org?.institutionsSheetId ? sheetUrl(org.institutionsSheetId) : null,
    syncedAt: org?.institutionsSyncedAt?.toISOString() ?? null,
    syncError: org?.institutionsSyncError ?? null,
    unmatchedColumns: org?.institutionsUnmatched ?? [],
    canManage: policy.isManager(p),
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      city: r.city,
      address: r.address,
      phone: r.phone,
      contactName: r.contactName,
      contactPhone: r.contactPhone,
      contactEmail: r.contactEmail,
      notes: r.notes,
    })),
  };
}

/** A manager connects (or replaces) the sheet; the list is read from it right away. */
export async function setInstitutionsSheet(ctx: AppContext, p: Principal, url: string): Promise<InstitutionsDto> {
  if (!policy.isManager(p)) throw forbidden();
  const parsed = parseGoogleUrl(url);
  if (!parsed || parsed.kind !== 'google_sheet') throw invalid('This is not a Google Sheets link');
  // Check it can be read before saving it.
  const raw = await readSheet(ctx, p.orgId, parsed.fileId, p.personId);
  if (mapSheet(raw).rows.length === 0) throw invalid('No rows with a yeshiva / kollel name were found in the first tab of the sheet');
  await ctx.db
    .update(organizations)
    .set({ institutionsSheetId: parsed.fileId, institutionsSheetBy: p.personId, institutionsSyncedAt: null, institutionsSyncError: null })
    .where(eq(organizations.id, p.orgId));
  await syncFromSheet(ctx, p.orgId);
  return getInstitutions(ctx, p);
}

export async function refreshInstitutions(ctx: AppContext, p: Principal): Promise<InstitutionsDto> {
  if (!policy.isManager(p)) throw forbidden();
  await syncFromSheet(ctx, p.orgId);
  return getInstitutions(ctx, p);
}
