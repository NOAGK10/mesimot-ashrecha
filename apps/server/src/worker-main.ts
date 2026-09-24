import { bootstrap } from './bootstrap';
import { startWorker } from './worker';

/** Standalone background worker process (production: WORKER_MODE=separate on the API). */
const { ctx, database } = await bootstrap();
const stop = startWorker(ctx);

const shutdown = async (signal: string) => {
  ctx.log.info({ signal }, 'worker shutting down');
  await stop();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
