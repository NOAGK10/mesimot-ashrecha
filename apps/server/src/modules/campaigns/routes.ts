import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { campaignItemSchema, campaignSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { addCampaignItem, createCampaign, deleteCampaign, deleteCampaignItem, getCampaign, getCampaignFile, listCampaigns, updateCampaign } from './campaign-service';

const params = z.object({ id: z.uuid() });
/** Shown in the browser; anything else is downloaded. Never HTML or SVG (scripts). */
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp)|audio\/[\w.+-]+|video\/(mp4|webm|quicktime)|application\/pdf)$/;

export function campaignRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/campaigns', async (req) => listCampaigns(ctx, requirePrincipal(req)));
  app.post('/api/campaigns', async (req, reply) => reply.code(201).send(await createCampaign(ctx, requirePrincipal(req), parse(campaignSchema, req.body))));
  app.get('/api/campaigns/:id', async (req) => getCampaign(ctx, requirePrincipal(req), parse(params, req.params).id));
  app.patch('/api/campaigns/:id', async (req) => {
    await updateCampaign(ctx, requirePrincipal(req), parse(params, req.params).id, parse(campaignSchema, req.body));
    return { ok: true };
  });
  app.post('/api/campaigns/:id/delete', async (req) => {
    await deleteCampaign(ctx, requirePrincipal(req), parse(params, req.params).id);
    return { ok: true };
  });
  app.post('/api/campaigns/:id/items', { bodyLimit: 4_400_000 }, async (req, reply) => {
    await addCampaignItem(ctx, requirePrincipal(req), parse(params, req.params).id, parse(campaignItemSchema, req.body));
    return reply.code(201).send({ ok: true });
  });
  app.post('/api/campaign-items/:id/delete', async (req) => {
    await deleteCampaignItem(ctx, requirePrincipal(req), parse(params, req.params).id);
    return { ok: true };
  });
  app.get('/api/campaign-items/:id/file', async (req, reply) => {
    const file = await getCampaignFile(ctx, requirePrincipal(req), parse(params, req.params).id);
    const inline = INLINE_TYPES.test(file.mimeType);
    return reply
      .header('content-type', inline ? file.mimeType : 'application/octet-stream')
      .header('content-disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, max-age=86400')
      .send(file.data);
  });
}
