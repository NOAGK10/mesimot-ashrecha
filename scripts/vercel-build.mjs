// Builds the site for Vercel using the Build Output API (https://vercel.com/docs/build-output-api/v3):
//   .vercel/output/static            the React app
//   .vercel/output/functions/api.func  the whole API as one Node.js function
//   .vercel/output/config.json       routing: /api/* → function, files as-is, everything else → index.html
// Database migrations run here, before the new version goes live.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel/output');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

rmSync(out, { recursive: true, force: true });

// 1. Web app and server bundles.
run('npm run build');

// 2. Migrations (only when a database is configured — local dry runs skip this).
if (process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.MIGRATE_DATABASE_URL) {
  run('node apps/server/dist/migrate-main.js');
} else {
  console.log('No DATABASE_URL — skipping migrations.');
}

// 3. Static files.
cpSync(path.join(root, 'apps/web/dist'), path.join(out, 'static'), { recursive: true });

// 4. The API function, bundled with its dependencies.
const fn = path.join(out, 'functions/api.func');
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: [path.join(root, 'apps/server/src/vercel-handler.ts')],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // The embedded database is for local development only and is never loaded in production.
  // drizzle's PGlite adapter must stay external too, or bundling turns its import into a load-time import.
  external: ['@electric-sql/pglite', 'drizzle-orm/pglite', 'drizzle-orm/pglite/migrator', 'pg-native'],
  // Some dependencies are CommonJS and expect require/__dirname.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);",
  },
  logLevel: 'warning',
});
writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 30, shouldAddHelpers: false }, null, 2),
);
writeFileSync(path.join(fn, 'package.json'), JSON.stringify({ type: 'module' }));
cpSync(path.join(root, 'apps/server/drizzle'), path.join(fn, 'drizzle'), { recursive: true });

// 5. Routing.
writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api/(.*)$', dest: '/api?__p=/api/$1' },
        { src: '^/(healthz|readyz)$', dest: '/api?__p=/$1' },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log('Vercel output ready in .vercel/output');
