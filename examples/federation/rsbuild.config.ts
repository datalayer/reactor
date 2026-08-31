/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The federation example.
 *
 * No design system and no backend on purpose: everything here is about where a
 * plugin's *module* comes from, and a store full of Primer cards would be a
 * larger thing to read than the subject.
 *
 * The remotes live in `public/`, so Rsbuild serves them in development and
 * copies them to `dist/` for a build — which is all "hosted somewhere else"
 * needs to mean for the shell to treat them as remote.
 */

import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: './src/main.tsx' } },
  html: { title: 'Reactor Federation' },
  server: { port: 5180 },
});
