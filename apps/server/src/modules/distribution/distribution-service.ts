import { and, asc, eq } from 'drizzle-orm';
import type { DistributionPointsDto, SheetColumnsDto } from '@org/shared';
import type { AppContext } from '../../context';
import { distributionPoints, sheetSources } from '../../db/schema';
import { AppError, forbidden, invalid } from '../../lib/errors';
import { parseGoogleUrl } from '../google/gateway';
import { mapSheetRows, normHeader, readSheetRows, sheetLink } from '../google/sheet-table';
import { policy } from '../identity/policy';
import type { Principal } from '../identity/principal';

/**
 * Distribution points from a Google Sheet a manager connects (name, phone, city, notes).
 * Like institutions and contacts: the sheet is the source, every update replaces the list, it updates
 * itself when opened after STALE_MS; managers and members see it; only managers connect the sheet.
 */

const KIND = 'distribution_points';
const STALE_MS = 10 * 60 * 1000;
type Field = 'name' | 'phone' | 'city' | 'notes';

export function pointFieldOf(header: string): Field | null {
  const h = normHeader(header);
  if (!h) return null;
  if (/טלפון|טל |^טל$|נייד|פלאפון|סלולרי|phone|mobile/.test(h)) return 'phone';
  if (/הערות|הערה|notes?|comments?/.test(h)) return 'notes';
  if (/^עיר|עיר$|עיר |יישוב|ישוב|city|town/.test(h)) return 'city';
  if (/שם|מוקד|נקודת|נקודה|name|point/.test(h)) return 'name';
  return null;
}

export const mapPointsSheet = (raw: string[][], choice?: Partial<Record<Field, string | null>> | null) =>
  mapSheetRows<Field>(raw, { fieldOf: pointFieldOf, order: ['name', 'phone', 'city', 'notes'], required: 'name', keepAll: true }, choice);

const where = (orgId: string) => and(eq(sheetSources.orgId, orgId), eq(sheetSources.kind, KIND));
const source = async (ctx: AppContext, orgId: string) => (await ctx.db.select().from(sheetSources).where(where(orgId)))[0] ?? null;

async function sync(ctx: AppContext, orgId: string): Promise<void> {
  const src = await source(ctx, orgId);
  if (!src) return;
  try {
    const m = mapPointsSheet(await readSheetRows(ctx, orgId, src.sheetId, src.byPersonId, src.gid), src.columns);
    const { rows, extras } = m;
    const stats = { rowsInSheet: m.dataRows, loaded: rows.length, skipped: m.skipped, columns: m.chosen, headers: m.headers };
    await ctx.db.transaction(async (tx) => {
      await tx.delete(distributionPoints).where(eq(distributionPoints.orgId, orgId));
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(distributionPoints).values(rows.slice(i, i + 500).map((r, j) => ({ ...r, extra: extras[i + j] ?? [], cells: m.cells[i + j] ?? [], orgId, position: i + j })));
      }
      // Other columns are shown on each card, so none are reported as "not shown".
      await tx.update(sheetSources).set({ syncedAt: ctx.now(), syncError: null, unmatched: [], stats }).where(where(orgId));
    });
  } catch (e) {
    const message = e instanceof AppError ? e.message : 'The sheet could not be read';
    await ctx.db.update(sheetSources).set({ syncedAt: ctx.now(), syncError: message }).where(where(orgId));
    if (e instanceof AppError) throw e;
    ctx.log.warn({ err: e }, 'distribution points sync failed');
  }
}

export async function getDistributionPoints(ctx: AppContext, p: Principal): Promise<DistributionPointsDto> {
  if (!policy.canCreateTask(p)) throw forbidden();
  let src = await source(ctx, p.orgId);
  if (src && (!src.syncedAt || ctx.now().getTime() - src.syncedAt.getTime() > STALE_MS)) {
    await sync(ctx, p.orgId).catch(() => undefined);
    src = await source(ctx, p.orgId);
  }
  const rows = await ctx.db.select().from(distributionPoints).where(eq(distributionPoints.orgId, p.orgId)).orderBy(asc(distributionPoints.position));
  return {
    headers: src?.stats?.headers ?? [],
    fieldColumns: src?.stats?.columns ?? {},
    stats: src?.stats && policy.isManager(p) ? { rowsInSheet: src.stats.rowsInSheet, loaded: src.stats.loaded, skipped: src.stats.skipped, columns: src.stats.columns, manual: !!src.columns } : null,
    sheetUrl: src ? sheetLink(src.sheetId, src.gid) : null,
    syncedAt: src?.syncedAt?.toISOString() ?? null,
    syncError: src?.syncError ?? null,
    unmatchedColumns: src?.unmatched ?? [],
    canManage: policy.isManager(p),
    items: rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, city: r.city, notes: r.notes, extra: r.extra ?? [], cells: r.cells ?? [] })),
  };
}

export async function setDistributionSheet(ctx: AppContext, p: Principal, url: string): Promise<DistributionPointsDto> {
  if (!policy.isManager(p)) throw forbidden();
  const parsed = parseGoogleUrl(url);
  if (!parsed || parsed.kind !== 'google_sheet') throw invalid('This is not a Google Sheets link');
  if (mapPointsSheet(await readSheetRows(ctx, p.orgId, parsed.fileId, p.personId, parsed.gid)).rows.length === 0) {
    throw invalid('No rows with a name were found in the first tab of the sheet');
  }
  // A new sheet starts with automatic recognition of its columns.
  const row = { orgId: p.orgId, kind: KIND, sheetId: parsed.fileId, gid: parsed.gid, byPersonId: p.personId, syncedAt: null, syncError: null, columns: null };
  await ctx.db.insert(sheetSources).values(row).onConflictDoUpdate({ target: [sheetSources.orgId, sheetSources.kind], set: row });
  await sync(ctx, p.orgId);
  return getDistributionPoints(ctx, p);
}

/** The sheet as read now: its headers, first rows and the columns used – for choosing columns by hand. */
export async function previewDistributionColumns(ctx: AppContext, p: Principal): Promise<SheetColumnsDto> {
  if (!policy.isManager(p)) throw forbidden();
  const src = await source(ctx, p.orgId);
  if (!src) throw invalid('No sheet is connected');
  const m = mapPointsSheet(await readSheetRows(ctx, p.orgId, src.sheetId, src.byPersonId, src.gid), src.columns);
  return { headers: m.headers, sample: m.sample, columns: m.chosen, rowsInSheet: m.dataRows, loaded: m.rows.length };
}

/** A manager chooses which column is which (null = back to automatic), and the list is read again. */
export async function setDistributionColumns(
  ctx: AppContext,
  p: Principal,
  columns: { name: string; phone: string | null; city: string | null; notes: string | null } | null,
): Promise<DistributionPointsDto> {
  if (!policy.isManager(p)) throw forbidden();
  if (!(await source(ctx, p.orgId))) throw invalid('No sheet is connected');
  await ctx.db.update(sheetSources).set({ columns }).where(where(p.orgId));
  await sync(ctx, p.orgId);
  return getDistributionPoints(ctx, p);
}

export async function refreshDistributionPoints(ctx: AppContext, p: Principal): Promise<DistributionPointsDto> {
  if (!policy.isManager(p)) throw forbidden();
  await sync(ctx, p.orgId);
  return getDistributionPoints(ctx, p);
}
