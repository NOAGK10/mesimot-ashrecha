import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { bootstrap } from './bootstrap';
import { bootstrapOrganization } from './seed';

/**
 * Serverless entry for Vercel. One Fastify instance is kept per warm function instance.
 * There is no in-process worker here: background duties run through POST /api/cron/tick,
 * called by the GitHub Actions schedule (.github/workflows/tick.yml).
 */
let app: Promise<FastifyInstance> | null = null;

async function init(): Promise<FastifyInstance> {
  const { ctx, database } = await bootstrap();
  const emails = ctx.config.BOOTSTRAP_MANAGER_EMAILS.split(',').map((e) => e.trim()).filter(Boolean);
  if (emails.length) await bootstrapOrganization(ctx, ctx.config.BOOTSTRAP_ORG_NAME, emails);
  const instance = await buildApp(ctx, { ping: database.ping });
  await instance.ready();
  return instance;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Routing passes the original path as ?__p= so it survives the rewrite to this single function.
  const url = new URL(req.url ?? '/', 'http://internal');
  const original = url.searchParams.get('__p');
  if (original) {
    url.searchParams.delete('__p');
    const rest = url.searchParams.toString();
    req.url = original + (rest ? `?${rest}` : '');
  }
  try {
    const instance = await (app ??= init().catch((err) => {
      app = null; // retry on the next request instead of caching the failure
      throw err;
    }));
    instance.server.emit('request', req, res);
  } catch (err) {
    console.error('startup failed', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'startup_failed', message: 'The server could not start. Check the environment variables.', details: describeStartupError(err) } }));
  }
}

/** Names the setting that is wrong — never its value — so the owner can fix it without reading server logs. */
function describeStartupError(err: unknown): string[] {
  const issues = (err as { issues?: Array<{ path: PropertyKey[]; message: string }> }).issues;
  if (Array.isArray(issues)) return issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const message = err instanceof Error ? err.message : String(err);
  // Configuration checks name variables only; anything else (e.g. database errors) is summarised.
  if (/^[A-Z_]+ (is required|must)|^Production requires/.test(message)) return [message];
  if (/ECONNREFUSED|ENOTFOUND|password authentication|database/i.test(message)) return ['Database connection failed: check DATABASE_URL'];
  return ['See the function logs in Vercel for details'];
}
