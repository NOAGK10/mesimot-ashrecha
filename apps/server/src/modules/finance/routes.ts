import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { financeEntrySchema, financeOpeningSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { deleteFinanceEntry, getFinance, reportFinance, setFinanceOpening } from './finance-service';

const params = z.object({ id: z.uuid() });

export function financeRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/finance', async (req) => getFinance(ctx, requirePrincipal(req)));
  app.post('/api/finance/entries', async (req, reply) => {
    await reportFinance(ctx, requirePrincipal(req), parse(financeEntrySchema, req.body));
    return reply.code(201).send({ ok: true });
  });
  app.post('/api/finance/entries/:id/delete', async (req) => {
    await deleteFinanceEntry(ctx, requirePrincipal(req), parse(params, req.params).id);
    return { ok: true };
  });
  app.put('/api/finance/opening', async (req) => {
    await setFinanceOpening(ctx, requirePrincipal(req), parse(financeOpeningSchema, req.body).amountAgorot);
    return { ok: true };
  });
}
