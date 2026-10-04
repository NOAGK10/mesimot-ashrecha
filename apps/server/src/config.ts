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
  /** Phase 2 Drive/Sheets access. All four are needed to enable the Google document features. */
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  /** Google Cloud project number, required by the Picker. */
  GOOGLE_APP_ID: z.string().optional(),
  /** 32 random bytes, base64. Encrypts stored Google refresh tokens. */
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
  /** Development-only sign-in by e-mail, without Google. Refused in production. */
  AUTH_DEV_LOGIN: bool.default(false),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MAGIC_LINK_TTL_DAYS: z.coerce.number().int().positive().default(14),
  /** 'inline' runs the background worker inside the API process (development). */
  WORKER_MODE: z.enum(['inline', 'separate']).default('inline'),
  WORKER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  RECURRENCE_HORIZON_DAYS: z.coerce.number().int().min(0).max(60).default(7),
  MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  SMTP_URL: z
    .string()
    .trim()
    .regex(/^smtps?:\/\/\S+$/, 'must start with smtps:// (or smtp://) and contain no spaces')
    .optional(),
  MAIL_FROM: z.string().default('Organization Tasks <no-reply@example.org>'),
  /** Comma-separated e-mails that become managers when the database is seeded. */
  BOOTSTRAP_MANAGER_EMAILS: z.string().default(''),
  BOOTSTRAP_ORG_NAME: z.string().default('אשריך'),
  WEB_DIST_DIR: z.string().optional(),
  /**
   * Free hosting sleeps when idle, so an external scheduler (GitHub Actions) calls POST /api/cron/tick
   * with this secret to run the background duties. Unset = endpoint disabled.
   */
  // Trimmed: a space or newline copied along with the value must not break the comparison.
  CRON_SECRET: z.string().trim().min(24).optional(),
  /** How often the external scheduler calls; only used to judge worker health. 0 = no scheduler. */
  CRON_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(0),
  /** Apply migrations when the API starts (hosts without a release step). */
  MIGRATE_ON_START: bool.default(false),
  /** Connections per server instance. Keep small on serverless hosts (many short-lived instances). */
  PG_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
});

export type Config = z.infer<typeof envSchema>;

/**
 * Values pasted into hosting dashboards often carry invisible characters (zero-width spaces from
 * translated pages, a BOM, surrounding whitespace). They break comparisons silently — e.g. Google
 * rejects a client ID with a leading U+200B as "OAuth client was not found" — so strip them all.
 */
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/g;
function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, typeof v === 'string' ? v.replace(INVISIBLE, '').trim() : v]));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = envSchema.parse(cleanEnv(env));
  if (config.NODE_ENV === 'production') {
    if (config.AUTH_DEV_LOGIN) throw new Error('AUTH_DEV_LOGIN must not be enabled in production');
    if (config.DATABASE_URL.startsWith('pglite:')) throw new Error('Production requires PostgreSQL');
    if (!config.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is required in production');
    if (config.MAIL_TRANSPORT !== 'smtp') throw new Error('Production requires MAIL_TRANSPORT=smtp');
  }
  if (config.MAIL_TRANSPORT === 'smtp' && !config.SMTP_URL) throw new Error('SMTP_URL is required');
  return config;
}
