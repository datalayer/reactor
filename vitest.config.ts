/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  /*
   * Plugin tests run against the reactor's *source*, not its built `lib/`.
   *
   * A plugin imports `@datalayer/reactor`, which resolves through
   * `node_modules` to the built package — a different module instance from the
   * one a test imports out of `src/`. They then have separate zustand stores,
   * and a plugin rendered by a test cannot see the platform the test
   * registered. It fails as "no reactor store registered", which reads like the
   * test forgot to set one up.
   *
   * The same reasoning as each plugin's `tsconfig.typecheck.json`: check the
   * plugin against the reactor beside it, not against whatever was last built.
   */
  resolve: {
    alias: [
      {
        find: /^@datalayer\/reactor\/react$/,
        replacement: fileURLToPath(new URL('./src/react/index.ts', import.meta.url)),
      },
      {
        find: /^@datalayer\/reactor$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
    ],
  },
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
