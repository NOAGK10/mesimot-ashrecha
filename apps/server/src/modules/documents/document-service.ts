import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { CategoryDto, DocumentDto, addDocumentSchema, updateDocumentSchema } from '@org/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db/client';
import { documentCategories, documents, taskDocuments, tasks } from '../../db/schema';
import { conflict, forbidden, invalid, notFound } from '../../lib/errors';
import { recordAudit } from '../audit/audit';
import { driveFor, driveIfConnected } from '../google/connection-service';
import { kindFromMime, parseGoogleUrl } from '../google/gateway';
import { policy } from '../identity/policy';
import { actorOf, type Principal } from '../identity/principal';

/**
 * Documents module (Phase 2). Stores references and metadata only — Google keeps the content
 * (architecture rule 5). Managers add and organise documents; anyone who can see a task sees its documents.
 */

type DocumentRow = typeof documents.$inferSelect;

async function taskIdsOf(db: Db, documentIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>(documentIds.map((id) => [id, []]));
  if (documentIds.length === 0) return map;
  const rows = await db
    .select({ documentId: taskDocuments.documentId, taskId: taskDocuments.taskId })
    .from(taskDocuments)
    .where(inArray(taskDocuments.documentId, documentIds));
  for (const r of rows) map.get(r.documentId)?.push(r.taskId);
  return map;
}

function toDto(d: DocumentRow, taskIds: string[]): DocumentDto {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    url: d.url,
    googleFileId: d.googleFileId,
    categoryId: d.categoryId,
    taskIds,
    createdAt: d.createdAt.toISOString(),
    archivedAt: d.archivedAt?.toISOString() ?? null,
  };
}

export async function listDocuments(ctx: AppContext, p: Principal, includeArchived = false): Promise<DocumentDto[]> {
  if (!policy.isManager(p)) throw forbidden();
  const where = [eq(documents.orgId, p.orgId)];
  if (!includeArchived) where.push(isNull(documents.archivedAt));
  const rows = await ctx.db.select().from(documents).where(and(...where)).orderBy(desc(documents.createdAt));
  const links = await taskIdsOf(ctx.db, rows.map((r) => r.id));
  return rows.map((r) => toDto(r, links.get(r.id) ?? []));
}

/** Documents attached to one task. Caller must already have checked that the task is visible. */
export async function documentsOfTask(db: Db, taskId: string): Promise<DocumentDto[]> {
  const rows = await db
    .select({ d: documents })
    .from(taskDocuments)
    .innerJoin(documents, eq(documents.id, taskDocuments.documentId))
    .where(eq(taskDocuments.taskId, taskId))
    .orderBy(asc(taskDocuments.addedAt));
  return rows.map((r) => toDto(r.d, [taskId]));
}

async function assertCategory(db: Db, orgId: string, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const [c] = await db.select({ orgId: documentCategories.orgId }).from(documentCategories).where(eq(documentCategories.id, categoryId));
  if (!c || c.orgId !== orgId) throw invalid('Unknown category');
}

/**
 * Inserts a document reference, or returns the existing one for the same Google file.
 * Exported for the import module, which records the source sheet of an import.
 */
export async function upsertDocument(
  tx: Db,
  p: Principal,
  d: { kind: DocumentRow['kind']; googleFileId: string | null; url: string; title: string; categoryId: string | null },
): Promise<DocumentRow> {
  if (d.googleFileId) {
    const [existing] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.orgId, p.orgId), eq(documents.googleFileId, d.googleFileId)));
    if (existing) {
      if (existing.archivedAt) {
        const [revived] = await tx.update(documents).set({ archivedAt: null }).where(eq(documents.id, existing.id)).returning();
        return revived!;
      }
      return existing;
    }
  }
  const [row] = await tx.insert(documents).values({ ...d, orgId: p.orgId, addedByPersonId: p.personId }).returning();
  return row!;
}

export async function linkToTask(tx: Db, p: Principal, taskId: string, documentId: string): Promise<void> {
  const [task] = await tx.select({ orgId: tasks.orgId }).from(tasks).where(eq(tasks.id, taskId));
  if (!task || task.orgId !== p.orgId) throw notFound('Task');
  const inserted = await tx
    .insert(taskDocuments)
    .values({ taskId, documentId, addedByPersonId: p.personId })
    .onConflictDoNothing()
    .returning();
  if (inserted.length) {
    await recordAudit(tx, { orgId: p.orgId, entityType: 'task', entityId: taskId, type: 'task.document_linked', actor: actorOf(p), data: { documentId } });
  }
}

export async function addDocument(ctx: AppContext, p: Principal, input: z.output<typeof addDocumentSchema>): Promise<DocumentDto> {
  if (!policy.isManager(p)) throw forbidden();
  let ref: { kind: DocumentRow['kind']; googleFileId: string | null; url: string; title: string };

  if ('googleFileId' in input) {
    const { api, refreshToken } = await driveFor(ctx, p);
    const meta = await api.getFile(refreshToken, input.googleFileId);
    if (!meta) throw invalid('The file is not accessible. Choose it again from Google Drive.');
    ref = { kind: kindFromMime(meta.mimeType), googleFileId: meta.id, url: meta.webViewLink, title: meta.name };
  } else {
    const google = parseGoogleUrl(input.url);
    let title = input.title;
    if (google && !title) {
      // drive.file only covers files the user picked, so this usually fails for pasted links — that's fine.
      const drive = await driveIfConnected(ctx, p);
      title = (await drive?.api.getFile(drive.refreshToken, google.fileId).catch(() => null))?.name;
    }
    ref = {
      kind: google?.kind ?? 'link',
      googleFileId: google?.fileId ?? null,
      url: input.url,
      title: title ?? (google?.kind === 'google_sheet' ? 'גיליון Google' : google?.kind === 'google_doc' ? 'מסמך Google' : input.url),
    };
  }

  return ctx.db.transaction(async (tx) => {
    await assertCategory(tx, p.orgId, input.categoryId);
    const doc = await upsertDocument(tx, p, { ...ref, categoryId: input.categoryId });
    if (input.taskId) await linkToTask(tx, p, input.taskId, doc.id);
    return toDto(doc, (await taskIdsOf(tx, [doc.id])).get(doc.id) ?? []);
  });
}

export async function uploadDocument(
  ctx: AppContext,
  p: Principal,
  file: { name: string; mimeType: string; data: Buffer },
  opts: { categoryId: string | null; taskId?: string },
): Promise<DocumentDto> {
  if (!policy.isManager(p)) throw forbidden();
  const { api, refreshToken } = await driveFor(ctx, p);
  const meta = await api.upload(refreshToken, file);
  return ctx.db.transaction(async (tx) => {
    await assertCategory(tx, p.orgId, opts.categoryId);
    const doc = await upsertDocument(tx, p, {
      kind: kindFromMime(meta.mimeType),
      googleFileId: meta.id,
      url: meta.webViewLink,
      title: meta.name,
      categoryId: opts.categoryId,
    });
    if (opts.taskId) await linkToTask(tx, p, opts.taskId, doc.id);
    return toDto(doc, (await taskIdsOf(tx, [doc.id])).get(doc.id) ?? []);
  });
}

export async function updateDocument(ctx: AppContext, p: Principal, id: string, input: z.output<typeof updateDocumentSchema>): Promise<DocumentDto> {
  if (!policy.isManager(p)) throw forbidden();
  return ctx.db.transaction(async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, id));
    if (!doc || doc.orgId !== p.orgId) throw notFound('Document');
    await assertCategory(tx, p.orgId, input.categoryId);
    const patch: Partial<DocumentRow> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    if (input.archived !== undefined) patch.archivedAt = input.archived ? (doc.archivedAt ?? ctx.now()) : null;
    const [updated] = Object.keys(patch).length ? await tx.update(documents).set(patch).where(eq(documents.id, id)).returning() : [doc];
    return toDto(updated!, (await taskIdsOf(tx, [id])).get(id) ?? []);
  });
}

export async function attachToTask(ctx: AppContext, p: Principal, taskId: string, documentId: string): Promise<void> {
  if (!policy.isManager(p)) throw forbidden();
  await ctx.db.transaction(async (tx) => {
    const [doc] = await tx.select({ orgId: documents.orgId }).from(documents).where(eq(documents.id, documentId));
    if (!doc || doc.orgId !== p.orgId) throw notFound('Document');
    await linkToTask(tx, p, taskId, documentId);
  });
}

export async function detachFromTask(ctx: AppContext, p: Principal, taskId: string, documentId: string): Promise<void> {
  if (!policy.isManager(p)) throw forbidden();
  await ctx.db.transaction(async (tx) => {
    const [task] = await tx.select({ orgId: tasks.orgId }).from(tasks).where(eq(tasks.id, taskId));
    if (!task || task.orgId !== p.orgId) throw notFound('Task');
    const removed = await tx
      .delete(taskDocuments)
      .where(and(eq(taskDocuments.taskId, taskId), eq(taskDocuments.documentId, documentId)))
      .returning();
    if (removed.length) {
      await recordAudit(tx, { orgId: p.orgId, entityType: 'task', entityId: taskId, type: 'task.document_unlinked', actor: actorOf(p), data: { documentId } });
    }
  });
}

// ---------------- Categories ----------------

export async function listCategories(ctx: AppContext, p: Principal): Promise<CategoryDto[]> {
  if (!policy.isManager(p)) throw forbidden();
  return ctx.db
    .select({ id: documentCategories.id, name: documentCategories.name })
    .from(documentCategories)
    .where(eq(documentCategories.orgId, p.orgId))
    .orderBy(asc(documentCategories.name));
}

export async function saveCategory(ctx: AppContext, p: Principal, name: string, id?: string): Promise<CategoryDto> {
  if (!policy.isManager(p)) throw forbidden();
  const [dup] = await ctx.db
    .select({ id: documentCategories.id })
    .from(documentCategories)
    .where(and(eq(documentCategories.orgId, p.orgId), eq(documentCategories.name, name)));
  if (dup && dup.id !== id) throw conflict('A category with this name already exists');
  if (!id) {
    const [row] = await ctx.db.insert(documentCategories).values({ orgId: p.orgId, name }).returning();
    return { id: row!.id, name: row!.name };
  }
  const [row] = await ctx.db
    .update(documentCategories)
    .set({ name })
    .where(and(eq(documentCategories.id, id), eq(documentCategories.orgId, p.orgId)))
    .returning();
  if (!row) throw notFound('Category');
  return { id: row.id, name: row.name };
}

/** Deleting a category keeps its documents; they become uncategorised. */
export async function deleteCategory(ctx: AppContext, p: Principal, id: string): Promise<void> {
  if (!policy.isManager(p)) throw forbidden();
  await ctx.db.delete(documentCategories).where(and(eq(documentCategories.id, id), eq(documentCategories.orgId, p.orgId)));
}
