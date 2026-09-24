import type { FastifyInstance } from 'fastify';
import { googleConnectSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { connectGoogle, disconnectGoogle, googleStatus, pickerToken } from './connection-service';

export function googleRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/google/status', async (req) => googleStatus(ctx, requirePrincipal(req)));
  app.post('/api/google/connect', async (req) => {
    await connectGoogle(ctx, requirePrincipal(req), parse(googleConnectSchema, req.body).code);
    return { ok: true };
  });
  app.delete('/api/google/connection', async (req) => {
    await disconnectGoogle(ctx, requirePrincipal(req));
    return { ok: true };
  });
  // Short-lived token for the Google Picker only; the refresh token never leaves the server.
  app.get('/api/google/picker-token', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return { accessToken: await pickerToken(ctx, requirePrincipal(req)) };
  });
}
