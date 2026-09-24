import { and, count, desc, eq, sql } from 'drizzle-orm';
import type { AppContext } from './context';
import { notifications, workerHeartbeats } from './db/schema';
import { dispatchDueNotifications } from './modules/notifications/dispatcher';
import { generateDueOccurrences } from './modules/recurrence/recurrence-service';

const WORKER_NAME = 'main';

/** One pass of all background duties. Each duty is isolated so one failure does not block the others. */
export async function runWorkerTick(ctx: AppContext): Promise<void> {
  const errors: string[] = [];
  const duty = async (name: string, fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      ctx.log.debug({ duty: name, result }, 'worker duty done');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${name}: ${message}`);
      ctx.log.error({ duty: name, err }, 'worker duty failed');
    }
  };
  await duty('recurrence', () => generateDueOccurrences(ctx));
  await duty('notifications', () => dispatchDueNotifications(ctx));

  const now = ctx.now();
  const errorFields = errors.length ? { lastError: errors.join('; '), lastErrorAt: now } : {};
  await ctx.db
    .insert(workerHeartbeats)
    .values({ name: WORKER_NAME, lastBeatAt: now, ...errorFields })
    .onConflictDoUpdate({ target: workerHeartbeats.name, set: { lastBeatAt: now, ...errorFields } });
}

/** Runs ticks on an interval without overlap. Returns a stop function that waits for the running tick. */
export function startWorker(ctx: AppContext): () => Promise<void> {
  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  const loop = () => {
    if (stopped) return;
    running = runWorkerTick(ctx)
      .catch((err) => ctx.log.error({ err }, 'worker tick crashed'))
      .finally(() => {
        if (!stopped) timer = setTimeout(loop, ctx.config.WORKER_INTERVAL_SECONDS * 1000);
      });
  };
  loop();
  ctx.log.info({ intervalSeconds: ctx.config.WORKER_INTERVAL_SECONDS }, 'background worker started');
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await running;
  };
}

/** Background-job visibility for managers (architecture §15 Observability). */
export async function workerStatus(ctx: AppContext) {
  const [beat] = await ctx.db.select().from(workerHeartbeats).where(eq(workerHeartbeats.name, WORKER_NAME));
  const byStatus = await ctx.db.select({ status: notifications.status, n: count() }).from(notifications).groupBy(notifications.status);
  const recentFailures = await ctx.db
    .select({ id: notifications.id, taskId: notifications.taskId, kind: notifications.kind, lastError: notifications.lastError, attempts: notifications.attempts })
    .from(notifications)
    .where(eq(notifications.status, 'failed'))
    .orderBy(desc(notifications.createdAt))
    .limit(20);
  const [overduePending] = await ctx.db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.status, 'pending'), sql`${notifications.sendAt} < ${new Date(ctx.now().getTime() - 15 * 60_000)}`));
  const lastBeatAgeSeconds = beat ? Math.round((ctx.now().getTime() - beat.lastBeatAt.getTime()) / 1000) : null;
  return {
    worker: {
      lastBeatAt: beat?.lastBeatAt.toISOString() ?? null,
      lastBeatAgeSeconds,
      healthy: lastBeatAgeSeconds !== null && lastBeatAgeSeconds < ctx.config.WORKER_INTERVAL_SECONDS * 4,
      lastError: beat?.lastError ?? null,
      lastErrorAt: beat?.lastErrorAt?.toISOString() ?? null,
    },
    notifications: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    backlogOlderThan15Min: overduePending?.n ?? 0,
    recentFailures,
  };
}
