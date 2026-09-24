import type { Logger } from 'pino';
import type { Config } from './config';
import type { Db } from './db/client';
import type { Mailer } from './modules/notifications/mailer';
import type { GoogleVerifier } from './modules/identity/google';

/** Dependencies handed to every service. `now` is injectable so time-based rules are testable. */
export interface AppContext {
  db: Db;
  config: Config;
  mailer: Mailer;
  google: GoogleVerifier | null;
  log: Logger;
  now: () => Date;
}
