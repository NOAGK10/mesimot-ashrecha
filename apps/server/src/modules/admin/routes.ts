import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { resetContent } from './reset-service';

export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/admin/reset-content', async (req) =>
    resetContent(ctx, requirePrincipal(req), parse(z.object({ confirmation: z.string().max(50) }), req.body).confirmation),
  );
}
