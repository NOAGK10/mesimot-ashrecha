import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  kind: 'postgres' | 'pglite';
  migrate(): Promise<void>;
  ping(): Promise<void>;
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
// Works both from src/db (tsx) and from dist/ (bundled).
const migrationsFolder =
  [path.resolve(here, '../../drizzle'), path.resolve(here, '../drizzle')].find((p) => existsSync(path.join(p, 'meta'))) ??
  path.resolve(here, '../drizzle');

/**
 * DATABASE_URL forms:
 *   postgres://…            real PostgreSQL (production)
 *   pglite:./.data/pglite   embedded PostgreSQL on disk (local development)
 *   pglite:memory           embedded PostgreSQL in memory (tests)
 */
export async function openDatabase(url: string): Promise<Database> {
  if (url.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const target = url.slice('pglite:'.length);
    if (target !== 'memory') mkdirSync(target, { recursive: true });
    const client = new PGlite(target === 'memory' ? undefined : target);
    const db = drizzle(client, { schema });
    return {
      db: db as unknown as Db,
      kind: 'pglite',
      migrate: () => migrate(db, { migrationsFolder }),
      ping: async () => void (await client.query('select 1')),
      close: () => client.close(),
    };
  }
  const pg = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const pool = new pg.default.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  return {
    db: db as unknown as Db,
    kind: 'postgres',
    migrate: () => migrate(db, { migrationsFolder }),
    ping: async () => void (await pool.query('select 1')),
    close: () => pool.end(),
  };
}
