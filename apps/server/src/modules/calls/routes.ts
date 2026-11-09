import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { callSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { createCall, deleteCall, listCalls, updateCall } from './call-service';

const params = z.object({ id: z.uuid() });

export function callRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/calls', async (req) => listCalls(ctx, requirePrincipal(req)));
  app.post('/api/calls', async (req, reply) => reply.code(201).send(await createCall(ctx, requirePrincipal(req), parse(callSchema, req.body))));
  app.put('/api/calls/:id', async (req) => updateCall(ctx, requirePrincipal(req), parse(params, req.params).id, parse(callSchema, req.body)));
  app.delete('/api/calls/:id', async (req, reply) => {
    await deleteCall(ctx, requirePrincipal(req), parse(params, req.params).id);
    return reply.code(204).send();
  });
}
