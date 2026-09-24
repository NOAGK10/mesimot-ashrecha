import { loadConfig } from './config';
import { openDatabase } from './db/client';

/** Release step: apply pending migrations, then exit. */
const config = loadConfig();
const database = await openDatabase(config.DATABASE_URL);
await database.migrate();
await database.close();
console.log('migrations applied');
