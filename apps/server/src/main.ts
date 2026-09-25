import { buildApp } from './app';
import { bootstrap } from './bootstrap';
import { bootstrapOrganization } from './seed';
import { startWorker } from './worker';

const { ctx, database } = await bootstrap();
if (ctx.config.MIGRATE_ON_START && database.kind === 'postgres') await database.migrate();

// First start on a host without shell access: create the organisation and its first managers.
const managerEmails = ctx.config.BOOTSTRAP_MANAGER_EMAILS.split(',').map((e) => e.trim()).filter(Boolean);
if (managerEmails.length) await bootstrapOrganization(ctx, ctx.config.BOOTSTRAP_ORG_NAME, managerEmails);

const app = await buildApp(ctx, { ping: database.ping });
const stopWorker = ctx.config.WORKER_MODE === 'inline' ? startWorker(ctx) : null;

await app.listen({ port: ctx.config.PORT, host: ctx.config.HOST });

const shutdown = async (signal: string) => {
  ctx.log.info({ signal }, 'shutting down');
  await app.close();
  await stopWorker?.();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
