import type { Logger } from 'pino';
import type { Config } from './config';
import type { Db } from './db/client';
import type { SecretBox } from './lib/secret-box';
import type { Mailer } from './modules/notifications/mailer';
import type { GoogleVerifier } from './modules/identity/google';
import type { GoogleWorkspace, PublicSheets } from './modules/google/gateway';

/** Dependencies handed to every service. `now` is injectable so time-based rules are testable. */
export interface AppContext {
  db: Db;
  config: Config;
  mailer: Mailer;
  google: GoogleVerifier | null;
  /** Drive/Sheets access; null when the Phase 2 Google settings are not configured. */
  googleWorkspace: { api: GoogleWorkspace; secrets: SecretBox } | null;
  publicSheets: PublicSheets;
  log: Logger;
  now: () => Date;
}
