import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().default('pglite:./.data/pglite'),
  /** Public base URL of the web app, used in e-mail links. */
  APP_URL: z.url().default('http://localhost:5173'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  /** Development-only sign-in by e-mail, without Google. Refused in production. */
  AUTH_DEV_LOGIN: bool.default(false),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MAGIC_LINK_TTL_DAYS: z.coerce.number().int().positive().default(14),
  /** 'inline' runs the background worker inside the API process (development). */
  WORKER_MODE: z.enum(['inline', 'separate']).default('inline'),
  WORKER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  RECURRENCE_HORIZON_DAYS: z.coerce.number().int().min(0).max(60).default(7),
  MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Organization Tasks <no-reply@example.org>'),
  /** Comma-separated e-mails that become managers when the database is seeded. */
  BOOTSTRAP_MANAGER_EMAILS: z.string().default(''),
  BOOTSTRAP_ORG_NAME: z.string().default('הארגון'),
  WEB_DIST_DIR: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = envSchema.parse(env);
  if (config.NODE_ENV === 'production') {
    if (config.AUTH_DEV_LOGIN) throw new Error('AUTH_DEV_LOGIN must not be enabled in production');
    if (config.DATABASE_URL.startsWith('pglite:')) throw new Error('Production requires PostgreSQL');
    if (!config.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is required in production');
    if (config.MAIL_TRANSPORT !== 'smtp') throw new Error('Production requires MAIL_TRANSPORT=smtp');
  }
  if (config.MAIL_TRANSPORT === 'smtp' && !config.SMTP_URL) throw new Error('SMTP_URL is required');
  return config;
}
