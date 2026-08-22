import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    /* The in-process MongoDB is shared per file, so files must not run in
       parallel against the same connection. */
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts'],
  },
});
