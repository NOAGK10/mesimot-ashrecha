import type { FastifyInstance } from 'fastify';
import { commitImportSchema, importPreviewGoogleSchema, importPreviewLinkSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { readUpload } from '../documents/routes';
import { commitImport, previewGoogleLink, previewGoogleSheet, previewUpload } from './import-service';

export function importRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/imports/preview/upload', async (req) => {
    const p = requirePrincipal(req);
    const file = await readUpload(req);
    return previewUpload(p, file.name, file.data);
  });
  app.post('/api/imports/preview/google', async (req) =>
    previewGoogleSheet(ctx, requirePrincipal(req), parse(importPreviewGoogleSchema, req.body).googleFileId),
  );
  app.post('/api/imports/preview/link', async (req) =>
    previewGoogleLink(ctx, requirePrincipal(req), parse(importPreviewLinkSchema, req.body).url),
  );
  app.post('/api/imports', async (req, reply) => {
    const result = await commitImport(ctx, requirePrincipal(req), parse(commitImportSchema, req.body));
    return reply.code(201).send(result);
  });
}
