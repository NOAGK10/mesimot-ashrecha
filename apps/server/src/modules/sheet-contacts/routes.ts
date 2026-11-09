import type { FastifyInstance } from 'fastify';
import { institutionsSourceSchema as sheetSourceSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { getSheetContacts, refreshSheetContacts, setContactsSheet } from './contacts-service';

export function sheetContactRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/sheet-contacts', async (req) => getSheetContacts(ctx, requirePrincipal(req)));
  app.put('/api/sheet-contacts/source', async (req) => setContactsSheet(ctx, requirePrincipal(req), parse(sheetSourceSchema, req.body).url));
  app.post('/api/sheet-contacts/refresh', async (req) => refreshSheetContacts(ctx, requirePrincipal(req)));
}
