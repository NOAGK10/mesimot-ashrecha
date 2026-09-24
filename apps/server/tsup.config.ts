import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/worker-main.ts', 'src/migrate-main.ts', 'src/seed-main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  // The shared contracts package ships TypeScript sources, so it is compiled into the bundle.
  noExternal: ['@org/shared'],
});
