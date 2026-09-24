import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createRecurrenceSchema, updateRecurrenceSchema, versionOnlySchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { createRecurrence, listRecurrences, setRecurrenceState, updateRecurrence } from './recurrence-service';

const params = z.object({ id: z.uuid() });
const actionParams = params.extend({ action: z.enum(['pause', 'resume', 'end']) });

export function recurrenceRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/recurrences', async (req) => listRecurrences(ctx, requirePrincipal(req)));

  app.post('/api/recurrences', async (req, reply) => {
    const def = await createRecurrence(ctx, requirePrincipal(req), parse(createRecurrenceSchema, req.body));
    return reply.code(201).send(def);
  });

  app.patch('/api/recurrences/:id', async (req) =>
    updateRecurrence(ctx, requirePrincipal(req), parse(params, req.params).id, parse(updateRecurrenceSchema, req.body)),
  );

  app.post('/api/recurrences/:id/:action', async (req) => {
    const { id, action } = parse(actionParams, req.params);
    return setRecurrenceState(ctx, requirePrincipal(req), id, parse(versionOnlySchema, req.body).version, action);
  });
}
