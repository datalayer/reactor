/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['src/react/**', 'jsdom']],
    setupFiles: ['./tests/vitest.setup.ts'],
  },
});
