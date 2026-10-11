/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The reactor.ui example's page, on Rsbuild. The server it talks to is
 * `ui_channel_example.server`, on port 8791.
 */

import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: { index: './src/main.tsx' },
  },
  html: {
    title: 'Reactor UI channel example',
  },
  server: {
    port: 5181,
  },
});
