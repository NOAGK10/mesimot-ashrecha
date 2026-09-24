import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { addDocumentSchema, categorySchema, linkDocumentSchema, updateDocumentSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { invalid } from '../../lib/errors';
import { parse } from '../../lib/validate';
import {
  addDocument,
  attachToTask,
  deleteCategory,
  detachFromTask,
  listCategories,
  listDocuments,
  saveCategory,
  updateDocument,
  uploadDocument,
} from './document-service';

const idParam = z.object({ id: z.uuid() });
const optionalUuid = z.uuid().optional().or(z.literal('').transform(() => undefined));

/** Reads one uploaded file plus plain form fields from a multipart request. */
export async function readUpload(req: FastifyRequest): Promise<{ name: string; mimeType: string; data: Buffer; fields: Record<string, string> }> {
  const part = await req.file();
  if (!part) throw invalid('No file was uploaded');
  const data = await part.toBuffer();
  if (part.file.truncated) throw invalid('The file is too large');
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(part.fields)) {
    const field = Array.isArray(v) ? v[0] : v;
    if (field && 'value' in field && typeof field.value === 'string') fields[k] = field.value;
  }
  return { name: part.filename, mimeType: part.mimetype, data, fields };
}

export function documentRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/documents', async (req) => {
    const { includeArchived } = parse(z.object({ includeArchived: z.coerce.boolean().default(false) }), req.query);
    return listDocuments(ctx, requirePrincipal(req), includeArchived);
  });

  app.post('/api/documents', async (req, reply) => {
    const doc = await addDocument(ctx, requirePrincipal(req), parse(addDocumentSchema, req.body));
    return reply.code(201).send(doc);
  });

  app.post('/api/documents/upload', async (req, reply) => {
    const p = requirePrincipal(req);
    const file = await readUpload(req);
    const opts = parse(z.object({ categoryId: optionalUuid, taskId: optionalUuid }), file.fields);
    const doc = await uploadDocument(ctx, p, file, { categoryId: opts.categoryId ?? null, taskId: opts.taskId });
    return reply.code(201).send(doc);
  });

  app.patch('/api/documents/:id', async (req) =>
    updateDocument(ctx, requirePrincipal(req), parse(idParam, req.params).id, parse(updateDocumentSchema, req.body)),
  );

  app.post('/api/tasks/:id/documents', async (req) => {
    await attachToTask(ctx, requirePrincipal(req), parse(idParam, req.params).id, parse(linkDocumentSchema, req.body).documentId);
    return { ok: true };
  });
  app.delete('/api/tasks/:id/documents/:documentId', async (req) => {
    const { id, documentId } = parse(idParam.extend({ documentId: z.uuid() }), req.params);
    await detachFromTask(ctx, requirePrincipal(req), id, documentId);
    return { ok: true };
  });

  app.get('/api/document-categories', async (req) => listCategories(ctx, requirePrincipal(req)));
  app.post('/api/document-categories', async (req, reply) => {
    const category = await saveCategory(ctx, requirePrincipal(req), parse(categorySchema, req.body).name);
    return reply.code(201).send(category);
  });
  app.patch('/api/document-categories/:id', async (req) =>
    saveCategory(ctx, requirePrincipal(req), parse(categorySchema, req.body).name, parse(idParam, req.params).id),
  );
  app.delete('/api/document-categories/:id', async (req) => {
    await deleteCategory(ctx, requirePrincipal(req), parse(idParam, req.params).id);
    return { ok: true };
  });
}
