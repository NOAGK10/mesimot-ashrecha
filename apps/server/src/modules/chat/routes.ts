import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { chatChannelQuerySchema, listMessagesQuerySchema, markChatReadSchema, markReadSchema, postMessageSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { listInbox, markRead, unreadCount } from '../inbox/inbox-service';
import { deleteMessage, getAttachment, listChannels, listMessages, listReceipts, markChatRead, postMessage } from './chat-service';

/** Shown in the page (images, recordings, PDFs); anything else is downloaded. */
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp)|audio\/[\w.+-]+(;\s*codecs=[\w.]+)?|video\/(mp4|webm)|application\/pdf)$/;

export function chatRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/chat/channels', async (req) => listChannels(ctx, requirePrincipal(req)));
  app.get('/api/chat/messages', async (req) => listMessages(ctx, requirePrincipal(req), parse(listMessagesQuerySchema, req.query)));
  // Room for a 3 MB file sent as base64 inside JSON.
  app.post('/api/chat/messages', { bodyLimit: 4_400_000 }, async (req, reply) => {
    const message = await postMessage(ctx, requirePrincipal(req), parse(postMessageSchema, req.body));
    return reply.code(201).send(message);
  });
  app.delete('/api/chat/messages/:id', async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    await deleteMessage(ctx, requirePrincipal(req), id);
    return { ok: true };
  });

  app.post('/api/chat/read', async (req) => {
    await markChatRead(ctx, requirePrincipal(req), parse(markChatReadSchema, req.body));
    return { ok: true };
  });
  app.get('/api/chat/receipts', async (req) => listReceipts(ctx, requirePrincipal(req), parse(chatChannelQuerySchema, req.query)));
  app.get('/api/chat/attachments/:id', async (req, reply) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const file = await getAttachment(ctx, requirePrincipal(req), id);
    const inline = INLINE_TYPES.test(file.mimeType);
    return reply
      .header('content-type', inline ? file.mimeType : 'application/octet-stream')
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, max-age=86400')
      .send(file.data);
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
