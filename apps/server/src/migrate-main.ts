import { openDatabase } from './db/client';

/**
 * Release step: apply pending migrations, then exit.
 * Uses a direct (non-pooled) connection when one is provided, e.g. Neon's DATABASE_URL_UNPOOLED on Vercel.
 * Reads the environment directly so it can run at build time without the full production config.
 */
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? 'pglite:./.data/pglite';
const database = await openDatabase(url, { poolMax: 1 });
await database.migrate();
await database.close();
console.log('migrations applied');
