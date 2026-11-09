import type { FastifyInstance } from 'fastify';
import { institutionsSourceSchema as sheetSourceSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { getDistributionPoints, refreshDistributionPoints, setDistributionSheet } from './distribution-service';

export function distributionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/distribution-points', async (req) => getDistributionPoints(ctx, requirePrincipal(req)));
  app.put('/api/distribution-points/source', async (req) => setDistributionSheet(ctx, requirePrincipal(req), parse(sheetSourceSchema, req.body).url));
  app.post('/api/distribution-points/refresh', async (req) => refreshDistributionPoints(ctx, requirePrincipal(req)));
}
