import type { z } from 'zod';
import type { ImportPreviewDto, ImportResultDto, commitImportSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { taskImportRows, taskImports } from '../../db/schema';
import { AppError, forbidden, invalid } from '../../lib/errors';
import { recordAudit } from '../audit/audit';
import { linkToTask, upsertDocument } from '../documents/document-service';
import { driveFor, driveIfConnected } from '../google/connection-service';
import { parseGoogleUrl } from '../google/gateway';
import { policy } from '../identity/policy';
import { actorOf, type Principal } from '../identity/principal';
import { replanReminders } from '../notifications/scheduling';
import { isOpen } from '../tasks/lifecycle';
import { assertActivePeople, insertTask } from '../tasks/task-store';
import { normalizeTable, parseCsv, parseUpload } from './parse';

/**
 * Sheet import: turns an existing hand-kept table into tasks, once.
 *
 * Preview reads the source and returns raw cells — nothing is stored. The manager maps columns,
 * people and statuses and reviews every row in the browser; only the approved rows are sent to
 * `commitImport`, which re-validates them and creates all tasks in a single transaction.
 * After the import the application is the source of truth; the sheet is not written back to.
 */

function requireManager(p: Principal) {
  if (!policy.isManager(p)) throw forbidden();
}

export async function previewUpload(p: Principal, filename: string, data: Buffer): Promise<ImportPreviewDto> {
  requireManager(p);
  const { tables, truncated } = await parseUpload(filename, data);
  return { sourceName: filename, googleFileId: null, tables, truncated };
}

export async function previewGoogleSheet(ctx: AppContext, p: Principal, fileId: string): Promise<ImportPreviewDto> {
  requireManager(p);
  const { api, refreshToken } = await driveFor(ctx, p);
  const [meta, raw] = await Promise.all([api.getFile(refreshToken, fileId), api.readSpreadsheet(refreshToken, fileId)]);
  if (!meta || !raw) throw invalid('The sheet is not accessible. Choose it again from Google Drive.');
  let truncated = false;
  const tables = raw.map((t) => {
    const n = normalizeTable(t.name, t.rows);
    truncated ||= n.truncated;
    return n.table;
  });
  return { sourceName: meta.name, googleFileId: meta.id, tables, truncated };
}

/** Pasted link: use the caller's Drive access if it covers the file, otherwise the public CSV export. */
export async function previewGoogleLink(ctx: AppContext, p: Principal, url: string): Promise<ImportPreviewDto> {
  requireManager(p);
  const parsed = parseGoogleUrl(url);
  if (!parsed || parsed.kind !== 'google_sheet') throw invalid('This is not a Google Sheets link');
  const drive = await driveIfConnected(ctx, p);
  if (drive) {
    const raw = await drive.api.readSpreadsheet(drive.refreshToken, parsed.fileId).catch(() => null);
    if (raw) return previewGoogleSheet(ctx, p, parsed.fileId);
  }
  const csv = await ctx.publicSheets.fetchCsv(parsed.fileId).catch(() => null);
  if (!csv) {
    throw new AppError(
      400,
      'sheet_not_accessible',
      'The sheet is private. Choose it with "Choose from Google Drive", or share it as "Anyone with the link" and try again.',
    );
  }
  const { table, truncated } = parseCsv('גיליון', csv);
  return { sourceName: 'גיליון Google', googleFileId: parsed.fileId, tables: [table], truncated };
}

export async function commitImport(ctx: AppContext, p: Principal, input: z.output<typeof commitImportSchema>): Promise<ImportResultDto> {
  requireManager(p);
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    await assertActivePeople(tx, p.orgId, input.rows.flatMap((r) => [r.ownerPersonId, ...r.participantIds]));

    const document = input.googleFileId
      ? await upsertDocument(tx, p, {
          kind: 'google_sheet',
          googleFileId: input.googleFileId,
          url: `https://docs.google.com/spreadsheets/d/${input.googleFileId}/edit`,
          title: input.sourceName,
          categoryId: input.categoryId,
        })
      : null;

    const [batch] = await tx
      .insert(taskImports)
      .values({
        orgId: p.orgId,
        sourceName: input.sourceName,
        sheetName: input.sheetName,
        documentId: document?.id ?? null,
        approvedByPersonId: p.personId,
        rowCount: input.rows.length,
        createdAt: now,
      })
      .returning();

    for (const row of input.rows) {
      const task = (await insertTask(
        tx,
        {
          orgId: p.orgId,
          title: row.title,
          description: row.description,
          ownerPersonId: row.ownerPersonId,
          dueDate: row.dueDate,
          participantIds: row.participantIds,
          createdByPersonId: p.personId,
          status: row.status,
        },
        now,
      ))!;
      await tx.insert(taskImportRows).values({ taskId: task.id, importId: batch!.id, sourceRow: row.sourceRow });
      await recordAudit(tx, {
        orgId: p.orgId,
        entityType: 'task',
        entityId: task.id,
        type: 'task.created',
        actor: actorOf(p),
        data: { importId: batch!.id, source: input.sourceName, sheet: input.sheetName, sourceRow: row.sourceRow, status: row.status, ownerPersonId: row.ownerPersonId, dueDate: row.dueDate },
      });
      if (document) await linkToTask(tx, p, task.id, document.id);
      // No "assigned" e-mails for a bulk import (these tasks already existed on paper); date reminders still apply.
      await replanReminders(tx, { ...task, open: isOpen(task.status) }, now);
    }
    return { importId: batch!.id, created: input.rows.length, documentId: document?.id ?? null };
  });
}
