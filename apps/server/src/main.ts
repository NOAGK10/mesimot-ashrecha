import { buildApp } from './app';
import { bootstrap } from './bootstrap';
import { startWorker } from './worker';

const { ctx, database } = await bootstrap();
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
