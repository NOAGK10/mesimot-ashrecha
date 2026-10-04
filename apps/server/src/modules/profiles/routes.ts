import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { postFeedbackSchema, updateProfileSchema, uploadAvatarSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { addFeedback, deleteAvatar, deleteFeedback, getAvatar, getProfile, setAvatar, updateProfile } from './profile-service';

const idParam = z.object({ id: z.uuid() });

export function profileRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/people/:id/profile', async (req) => getProfile(ctx, requirePrincipal(req), parse(idParam, req.params).id));
  app.patch('/api/people/:id/profile', async (req) => {
    await updateProfile(ctx, requirePrincipal(req), parse(idParam, req.params).id, parse(updateProfileSchema, req.body));
    return { ok: true };
  });

  app.put('/api/people/:id/avatar', { bodyLimit: 600_000 }, async (req) => {
    await setAvatar(ctx, requirePrincipal(req), parse(idParam, req.params).id, parse(uploadAvatarSchema, req.body).dataUrl);
    return { ok: true };
  });
  app.delete('/api/people/:id/avatar', async (req) => {
    await deleteAvatar(ctx, requirePrincipal(req), parse(idParam, req.params).id);
    return { ok: true };
  });
  // The URL carries ?v=<version>, so the browser may cache each version.
  app.get('/api/people/:id/avatar', async (req, reply) => {
    const avatar = await getAvatar(ctx, requirePrincipal(req), parse(idParam, req.params).id);
    return reply
      .header('content-type', avatar.mimeType)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=86400')
      .send(avatar.data);
  });

  app.post('/api/people/:id/feedback', async (req, reply) => {
    const feedback = await addFeedback(ctx, requirePrincipal(req), parse(idParam, req.params).id, parse(postFeedbackSchema, req.body).body);
    return reply.code(201).send(feedback);
  });
  app.delete('/api/feedback/:id', async (req) => {
    await deleteFeedback(ctx, requirePrincipal(req), parse(z.object({ id: z.coerce.number().int().positive() }), req.params).id);
    return { ok: true };
  });
}
