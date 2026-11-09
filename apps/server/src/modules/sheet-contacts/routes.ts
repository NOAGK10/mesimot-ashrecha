import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { contactCategoryMembersSchema, contactCategorySchema, institutionsSourceSchema as sheetSourceSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { getSheetContacts, refreshSheetContacts, setContactsSheet } from './contacts-service';
import { createContactCategory, deleteContactCategory, setContactCategoryMembers, updateContactCategory } from './category-service';

const params = z.object({ id: z.uuid() });

export function sheetContactRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/sheet-contacts', async (req) => getSheetContacts(ctx, requirePrincipal(req)));
  app.put('/api/sheet-contacts/source', async (req) => setContactsSheet(ctx, requirePrincipal(req), parse(sheetSourceSchema, req.body).url));
  app.post('/api/sheet-contacts/refresh', async (req) => refreshSheetContacts(ctx, requirePrincipal(req)));

  app.post('/api/contact-categories', async (req, reply) =>
    reply.code(201).send(await createContactCategory(ctx, requirePrincipal(req), parse(contactCategorySchema, req.body))),
  );
  app.patch('/api/contact-categories/:id', async (req) => {
    await updateContactCategory(ctx, requirePrincipal(req), parse(params, req.params).id, parse(contactCategorySchema, req.body));
    return { ok: true };
  });
  app.post('/api/contact-categories/:id/delete', async (req) => {
    await deleteContactCategory(ctx, requirePrincipal(req), parse(params, req.params).id);
    return { ok: true };
  });
  app.put('/api/contact-categories/:id/members', async (req) => {
    await setContactCategoryMembers(ctx, requirePrincipal(req), parse(params, req.params).id, parse(contactCategoryMembersSchema, req.body).keys);
    return { ok: true };
  });
}
