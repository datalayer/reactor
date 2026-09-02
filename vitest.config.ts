/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.{ts,tsx}',
      // The plugins in this repo ship as their own packages, and their rules
      // are worth the same coverage as the core's.
      'plugins/*/__tests__/**/*.test.{ts,tsx}',
    ],
    environmentMatchGlobs: [['src/react/**', 'jsdom']],
    setupFiles: ['./tests/vitest.setup.ts'],
    fileParallelism: false,
    pool: 'forks',
    // Vitest 4 lifted the per-pool options to the top level; this is what
    // `poolOptions.forks.singleFork` used to say.
    singleFork: true,
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
