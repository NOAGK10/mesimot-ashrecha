import { pino, type Logger } from 'pino';
import { loadConfig, type Config } from './config';
import type { AppContext } from './context';
import { openDatabase, type Database } from './db/client';
import { googleVerifier } from './modules/identity/google';
import { createMailer } from './modules/notifications/mailer';

export function createLogger(config: Config): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: 'org-management' },
    redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
  });
}

/** Shared start-up for the API and worker processes. */
export async function bootstrap(): Promise<{ ctx: AppContext; database: Database }> {
  const config = loadConfig();
  const log = createLogger(config);
  const database = await openDatabase(config.DATABASE_URL);
  // Embedded development database migrates itself; production runs `migrate` as a release step.
  if (database.kind === 'pglite') await database.migrate();
  const ctx: AppContext = {
    db: database.db,
    config,
    log,
    mailer: createMailer(config, log),
    google: config.GOOGLE_CLIENT_ID ? googleVerifier(config.GOOGLE_CLIENT_ID) : null,
    now: () => new Date(),
  };
  return { ctx, database };
}
