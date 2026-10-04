import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each integration test file runs its own in-memory PostgreSQL (PGlite); too many at once
    // can exhaust memory on a laptop, so keep parallelism modest.
    maxWorkers: 2,
  },
});
