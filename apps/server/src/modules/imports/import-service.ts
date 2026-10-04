import type { z } from 'zod';
import type { ImportPreviewDto, ImportResultDto, commitImportSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { taskImportRows, taskImports } from '../../db/schema';
import { AppError, forbidden, invalid } from '../../lib/errors';
import { recordAudit } from '../audit/audit';
import { linkToTask, upsertDocument } from '../documents/document-service';
import { driveFor, driveIfConnected } from '../google/connection-service';
import { kindFromMime, parseGoogleUrl } from '../google/gateway';
import { policy } from '../identity/policy';
import { actorOf, type Principal } from '../identity/principal';
import { replanReminders } from '../notifications/scheduling';
import { isOpen } from '../tasks/lifecycle';
import { assertTaskCategory } from '../tasks/category-service';
import { assertActivePeople, insertTask } from '../tasks/task-store';
import { normalizeTable, parseCsv, parseUpload } from './parse';
import { parseDocx } from './parse-docx';

/**
 * Import: turns an existing hand-kept table (Excel, CSV, Google Sheet) or the tables and bulleted
 * lists of a document (Word, Google Doc) into tasks, once.
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
  const lower = filename.toLowerCase();
  if (lower.endsWith('.doc')) throw invalid('Old .doc files are not supported. Save the document as .docx and try again.');
  const { tables, truncated } = lower.endsWith('.docx') ? await parseDocx(data) : await parseUpload(filename, data);
  return { sourceName: filename, googleFileId: null, googleFileKind: null, tables, truncated };
}

/** A Google Sheet or Google Doc the user picked in Drive. Docs are read through their .docx export. */
export async function previewGoogleFile(ctx: AppContext, p: Principal, fileId: string): Promise<ImportPreviewDto> {
  requireManager(p);
  const { api, refreshToken } = await driveFor(ctx, p);
  const meta = await api.getFile(refreshToken, fileId);
  const kind = meta ? kindFromMime(meta.mimeType) : null;
  if (!meta || kind === 'link') throw invalid('Choose a Google Sheet or a Google Doc');

  if (kind === 'google_doc') {
    const docx = await api.exportDocx(refreshToken, fileId);
    if (!docx) throw invalid('The document is not accessible. Choose it again from Google Drive.');
    const { tables, truncated } = await parseDocx(docx);
    return { sourceName: meta.name, googleFileId: meta.id, googleFileKind: 'google_doc', tables, truncated };
  }
  const raw = await api.readSpreadsheet(refreshToken, fileId);
  if (!raw) throw invalid('The sheet is not accessible. Choose it again from Google Drive.');
  let truncated = false;
  const tables = raw.map((t) => {
    const n = normalizeTable(t.name, t.rows);
    truncated ||= n.truncated;
    return n.table;
  });
  return { sourceName: meta.name, googleFileId: meta.id, googleFileKind: 'google_sheet', tables, truncated };
}

const notAccessible = () =>
  new AppError(
    400,
    'sheet_not_accessible',
    'The file is private. Choose it with "Choose from Google Drive", or share it as "Anyone with the link" and try again.',
  );

/** Pasted link: use the caller's Drive access if it covers the file, otherwise the public export. */
export async function previewGoogleLink(ctx: AppContext, p: Principal, url: string): Promise<ImportPreviewDto> {
  requireManager(p);
  const parsed = parseGoogleUrl(url);
  if (!parsed || parsed.kind === 'link') throw invalid('This is not a Google Sheets or Google Docs link');
  const drive = await driveIfConnected(ctx, p);
  if (drive) {
    const meta = await drive.api.getFile(drive.refreshToken, parsed.fileId).catch(() => null);
    if (meta) return previewGoogleFile(ctx, p, parsed.fileId);
  }
  if (parsed.kind === 'google_doc') {
    const docx = await ctx.publicSheets.fetchDocx(parsed.fileId).catch(() => null);
    if (!docx) throw notAccessible();
    const { tables, truncated } = await parseDocx(docx);
    return { sourceName: 'מסמך Google', googleFileId: parsed.fileId, googleFileKind: 'google_doc', tables, truncated };
  }
  const csv = await ctx.publicSheets.fetchCsv(parsed.fileId).catch(() => null);
  if (!csv) throw notAccessible();
  const { table, truncated } = parseCsv('גיליון', csv);
  return { sourceName: 'גיליון Google', googleFileId: parsed.fileId, googleFileKind: 'google_sheet', tables: [table], truncated };
}

export async function commitImport(ctx: AppContext, p: Principal, input: z.output<typeof commitImportSchema>): Promise<ImportResultDto> {
  requireManager(p);
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    await assertActivePeople(tx, p.orgId, input.rows.flatMap((r) => [r.ownerPersonId, ...r.participantIds]));
    for (const categoryId of new Set(input.rows.map((r) => r.categoryId))) await assertTaskCategory(tx, p.orgId, categoryId);

    const document = input.googleFileId
      ? await upsertDocument(tx, p, {
          kind: input.googleFileKind,
          googleFileId: input.googleFileId,
          url: `https://docs.google.com/${input.googleFileKind === 'google_doc' ? 'document' : 'spreadsheets'}/d/${input.googleFileId}/edit`,
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
          categoryId: row.categoryId ?? null,
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
        data: { importId: batch!.id, source: input.sourceName, sheet: input.sheetName, sourceRow: row.sourceRow, status: row.status, ownerPersonId: row.ownerPersonId, dueDate: row.dueDate, categoryId: row.categoryId ?? null },
      });
      if (document) await linkToTask(tx, p, task.id, document.id);
      // No "assigned" e-mails for a bulk import (these tasks already existed on paper); date reminders still apply.
      await replanReminders(tx, { ...task, open: isOpen(task.status) }, now);
    }
    return { importId: batch!.id, created: input.rows.length, documentId: document?.id ?? null };
  });
}
