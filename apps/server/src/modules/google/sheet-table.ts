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

/** Reads the first tab: through the connecting manager's Google account if possible, otherwise the public export. */
export async function readSheetRows(ctx: AppContext, orgId: string, fileId: string, byPersonId: string | null): Promise<string[][]> {
  if (byPersonId) {
    const [by] = await ctx.db.select().from(people).where(eq(people.id, byPersonId));
    if (by && !by.deactivatedAt) {
      const drive = await driveIfConnected(ctx, { personId: by.id, orgId, access: 'manager', scopeTaskId: null, via: 'session' } as Principal).catch(() => null);
      const tables = drive ? await drive.api.readSpreadsheet(drive.refreshToken, fileId).catch(() => null) : null;
      if (tables?.[0]) return tables[0].rows;
    }
  }
  const csv = await ctx.publicSheets.fetchCsv(fileId).catch(() => null);
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
}

/** Finds the header row (within the first rows), maps columns to fields and returns the data rows. */
export function mapSheetRows<F extends string>(raw: string[][], spec: SheetSpec<F>): MappedRows<F> {
  let headerAt = -1;
  let columns: (F | null)[] = [];
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
  const used = new Set<F>();
  if (headerAt >= 0) {
    // One column per field: the first one wins.
    columns = columns.map((f) => (f && !used.has(f) ? (used.add(f), f) : null));
  } else {
    columns = [...spec.order];
  }
  const unmatched = headerAt >= 0 ? raw[headerAt]!.filter((h, i) => h.trim() && !columns[i]) : [];
  const rows = raw
    .slice(headerAt + 1)
    .map((r) => {
      const row = Object.fromEntries(spec.order.map((f) => [f, ''])) as Record<F, string>;
      columns.forEach((f, i) => {
        if (f) row[f] = (r[i] ?? '').trim().slice(0, 2000);
      });
      return row;
    })
    .filter((r) => r[spec.required]);
  return { rows, unmatched };
}
