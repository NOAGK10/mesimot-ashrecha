import { bootstrap } from './bootstrap';
import { bootstrapOrganization, seedDemo } from './seed';

const { ctx, database } = await bootstrap();
const emails = ctx.config.BOOTSTRAP_MANAGER_EMAILS.split(',').map((e) => e.trim()).filter(Boolean);
const orgId = await bootstrapOrganization(ctx, ctx.config.BOOTSTRAP_ORG_NAME, emails);
if (process.argv.includes('--demo')) await seedDemo(ctx, orgId);
await database.close();
console.log(`organization ready: ${orgId}`);
