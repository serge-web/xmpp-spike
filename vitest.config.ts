import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['spike/tests/checks/**/*.test.ts'],
    globalSetup: ['spike/tests/global-setup.ts'],
    // Checks share one live server; run files serially so they don't interfere.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
