import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import type { AppContext } from './context';
import { attachPrincipal, requirePrincipal } from './http';
import { AppError, forbidden } from './lib/errors';
import { documentRoutes } from './modules/documents/routes';
import { googleRoutes } from './modules/google/routes';
import { identityRoutes } from './modules/identity/routes';
import { importRoutes } from './modules/imports/routes';
import { policy } from './modules/identity/policy';
import { ConsoleMailer } from './modules/notifications/mailer';
import { recurrenceRoutes } from './modules/recurrence/routes';
import { taskRoutes } from './modules/tasks/routes';
import { runWorkerTick, workerStatus } from './worker';

export interface AppOptions {
  ping: () => Promise<void>;
}

export async function buildApp(ctx: AppContext, opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: ctx.log as FastifyBaseLogger, trustProxy: true });
  app.decorateRequest('principal', null);
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: ctx.config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10 } });

  // CSRF defence in depth (cookies are also SameSite=Lax): state-changing API calls must come from our client.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || req.method === 'GET' || req.method === 'HEAD') return;
    if (req.headers['x-requested-with'] !== 'fetch') throw new AppError(403, 'csrf', 'Missing request header');
  });
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/')) await attachPrincipal(ctx, req);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: 'bad_request', message: (err as Error).message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Internal error' } });
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await opts.ping();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  identityRoutes(app, ctx);
  taskRoutes(app, ctx);
  recurrenceRoutes(app, ctx);
  documentRoutes(app, ctx);
  importRoutes(app, ctx);
  googleRoutes(app, ctx);

  // Wake-up call from the external scheduler (free hosting sleeps, so the in-process loop is not enough).
  const cronSecret = ctx.config.CRON_SECRET;
  if (cronSecret) {
    app.post('/api/cron/tick', async (req, reply) => {
      const given = Buffer.from(String(req.headers['x-cron-secret'] ?? ''));
      const expected = Buffer.from(cronSecret);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        return reply.code(401).send({ error: { code: 'unauthenticated', message: 'Bad cron secret' } });
      }
      await runWorkerTick(ctx);
      return { ok: true };
    });
  }

  app.get('/api/ops/status', async (req) => {
    if (!policy.canViewOperations(requirePrincipal(req))) throw forbidden();
    return workerStatus(ctx);
  });

  if (ctx.config.NODE_ENV !== 'production' && ctx.mailer instanceof ConsoleMailer) {
    const mailer = ctx.mailer;
    app.get('/api/dev/outbox', async () => mailer.sent);
  }

  if (ctx.config.WEB_DIST_DIR) {
    const root = path.resolve(ctx.config.WEB_DIST_DIR);
    await app.register(fastifyStatic, { root, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: { code: 'not_found', message: 'Route not found' } });
    });
  }
  return app;
}
