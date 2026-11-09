import type { FastifyInstance } from 'fastify';
import { institutionsSourceSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { getInstitutions, refreshInstitutions, setInstitutionsSheet } from './institution-service';

export function institutionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/institutions', async (req) => getInstitutions(ctx, requirePrincipal(req)));
  app.put('/api/institutions/source', async (req) => setInstitutionsSheet(ctx, requirePrincipal(req), parse(institutionsSourceSchema, req.body).url));
  app.post('/api/institutions/refresh', async (req) => refreshInstitutions(ctx, requirePrincipal(req)));
}
