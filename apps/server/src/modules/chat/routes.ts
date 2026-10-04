import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listMessagesQuerySchema, markReadSchema, postMessageSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { listInbox, markRead, unreadCount } from '../inbox/inbox-service';
import { deleteMessage, listMessages, postMessage } from './chat-service';

export function chatRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/chat/messages', async (req) => listMessages(ctx, requirePrincipal(req), parse(listMessagesQuerySchema, req.query)));
  app.post('/api/chat/messages', async (req, reply) => {
    const message = await postMessage(ctx, requirePrincipal(req), parse(postMessageSchema, req.body));
    return reply.code(201).send(message);
  });
  app.delete('/api/chat/messages/:id', async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    await deleteMessage(ctx, requirePrincipal(req), id);
    return { ok: true };
  });

  app.get('/api/inbox', async (req) => {
    const p = requirePrincipal(req);
    return { unread: await unreadCount(ctx, p), items: await listInbox(ctx, p) };
  });
  app.get('/api/inbox/unread-count', async (req) => ({ unread: await unreadCount(ctx, requirePrincipal(req)) }));
  app.post('/api/inbox/read', async (req) => {
    await markRead(ctx, requirePrincipal(req), parse(markReadSchema, req.body));
    return { ok: true };
  });
}
