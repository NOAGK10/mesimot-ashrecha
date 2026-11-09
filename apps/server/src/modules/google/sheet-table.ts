import { eq } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { people } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { parseCsv } from '../imports/parse';
import type { Principal } from '../identity/principal';
import { driveIfConnected } from './connection-service';

/** Lists that live in a Google Sheet (institutions, contacts): reading the sheet and mapping its columns. */

export const sheetNotAccessible = () =>
  new AppError(400, 'sheet_not_accessible', 'The sheet is private. Share it as "Anyone with the link can view", or connect Google Drive first.');

/** The address of a sheet (and tab) to show people. */
export const sheetLink = (fileId: string, gid: string | null) => `https://docs.google.com/spreadsheets/d/${fileId}/edit${gid ? `#gid=${gid}` : ''}`;

/**
 * Reads the tab the link points to (its gid), or the first tab: through the connecting manager's Google
 * account if possible, otherwise the public export.
 */
export async function readSheetRows(ctx: AppContext, orgId: string, fileId: string, byPersonId: string | null, gid: string | null = null): Promise<string[][]> {
  if (byPersonId) {
    const [by] = await ctx.db.select().from(people).where(eq(people.id, byPersonId));
    if (by && !by.deactivatedAt) {
      const drive = await driveIfConnected(ctx, { personId: by.id, orgId, access: 'manager', scopeTaskId: null, via: 'session' } as Principal).catch(() => null);
      const tables = drive ? await drive.api.readSpreadsheet(drive.refreshToken, fileId).catch(() => null) : null;
      const table = gid ? tables?.find((t) => t.gid === gid) : tables?.[0];
      if (table) return table.rows;
    }
  }
  const csv = await ctx.publicSheets.fetchCsv(fileId, gid).catch(() => null);
  if (!csv) throw sheetNotAccessible();
  return parseCsv('גיליון', csv).table.rows;
}

/** Lower-case, punctuation (incl. Hebrew geresh/gershayim) to spaces – for matching header names. */
export const normHeader = (s: string) => s.toLowerCase().replace(/["'״׳`.,:;()\-_/\\|]+/g, ' ').replace(/\s+/g, ' ').trim();

export interface SheetSpec<F extends string> {
  fieldOf: (header: string) => F | null;
  /** Column order to assume when the sheet has no header row (the order the user listed them in). */
  order: readonly F[];
  /** Rows without this field are skipped; the header row must name it. */
  required: F;
}

export interface MappedRows<F extends string> {
  rows: Record<F, string>[];
  unmatched: string[];
  /** Per row (same order as rows): the non-empty cells of unrecognised columns, as [header, value]. */
  extras: [string, string][][];
  /** What was read, for the manager's "which column is which" screen. */
  headers: string[];
  /** The column chosen for each field ('' = none). */
  chosen: Record<F, string>;
  /** Non-empty rows under the header, and how many of them had no value in the required column. */
  dataRows: number;
  skipped: number;
  /** The first rows under the header, as read. */
  sample: string[][];
}

/** A manager's choice: for each field, the header of its column (null = not in the sheet). */
export type ColumnChoice<F extends string> = Partial<Record<F, string | null>>;

const cellKey = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * Finds the header row (within the first rows), maps columns to fields and returns the data rows.
 * With a manager's choice of columns, the header row is the one naming most of the chosen headers.
 */
export function mapSheetRows<F extends string>(raw: string[][], spec: SheetSpec<F>, choice?: ColumnChoice<F> | null): MappedRows<F> {
  let headerAt = -1;
  let columns: (F | null)[] = [];
  const chosen = choice ? Object.entries(choice).filter(([, h]) => h) as [F, string][] : [];
  if (chosen.length) {
    let best = 0;
    for (let i = 0; i < Math.min(raw.length, 10); i++) {
      const cells = raw[i]!.map(cellKey);
      const hits = chosen.filter(([, h]) => cells.includes(cellKey(h))).length;
      if (hits > best) {
        best = hits;
        headerAt = i;
        columns = cells.map((c) => chosen.find(([, h]) => cellKey(h) === c)?.[0] ?? null);
      }
    }
  }
  if (headerAt < 0) {
    // The header row is the one (among the first rows) that names the most columns, including the
    // required one; a title line such as "רשימת מוסדות" above it names fewer.
    let best = 0;
    for (let i = 0; i < Math.min(raw.length, 6); i++) {
      const fields = raw[i]!.map(spec.fieldOf);
      const known = fields.filter(Boolean).length;
      const filled = raw[i]!.filter((c) => c.trim()).length;
      if (fields.includes(spec.required) && (known >= 2 || known === filled) && known > best) {
        best = known;
        headerAt = i;
        columns = fields;
      }
    }
  }
  const used = new Set<F>();
  if (headerAt >= 0) {
    // One column per field: the first one wins.
    columns = columns.map((f) => (f && !used.has(f) ? (used.add(f), f) : null));
  } else {
    columns = [...spec.order];
  }
  const header = headerAt >= 0 ? raw[headerAt]! : [];
  const unmatched = header.filter((h, i) => h.trim() && !columns[i]);
  const body = raw.slice(headerAt + 1).filter((r) => r.some((c) => c.trim()));
  const mapped = body.map((r) => {
    const row = Object.fromEntries(spec.order.map((f) => [f, ''])) as Record<F, string>;
    columns.forEach((f, i) => {
      if (f) row[f] = (r[i] ?? '').trim().slice(0, 2000);
    });
    const extra: [string, string][] = [];
    header.forEach((h, i) => {
      const v = (r[i] ?? '').trim();
      if (h.trim() && !columns[i] && v) extra.push([h.trim().slice(0, 100), v.slice(0, 1000)]);
    });
    return { row, extra };
  });
  const kept = mapped.filter((m) => m.row[spec.required]);
  const chosenOut = Object.fromEntries(spec.order.map((f) => [f, header[columns.indexOf(f)]?.trim() ?? ''])) as Record<F, string>;
  return {
    rows: kept.map((m) => m.row),
    unmatched,
    extras: kept.map((m) => m.extra),
    headers: header.map((h) => h.trim()),
    chosen: chosenOut,
    dataRows: body.length,
    skipped: body.length - kept.length,
    sample: body.slice(0, 5).map((r) => header.map((_, i) => (r[i] ?? '').trim().slice(0, 120))),
  };
}
