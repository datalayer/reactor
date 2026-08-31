/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The CMS shell, on shadcn/ui.
 *
 * A second application on a second design system, which is what
 * [#11](https://github.com/datalayer/reactor/issues/11) is really asking for: a
 * claim that the plugin model is independent of the UI kit is only worth
 * anything if somebody has built the other one.
 *
 * Note what is *not* here: nothing about plugins. The plugins arrive from
 * Python packages at runtime, so this config knows about Tailwind and React and
 * nothing else. That is the whole point being demonstrated.
 */

import path from 'node:path';

import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

const REACTOR = path.resolve(__dirname, '../../..');

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: { index: './src/main.tsx' },
    define: {
      // Same story as the music store: the Python host serves this bundle from
      // the origin it serves the API from, so production needs no address at
      // all. Development is the split case.
      __REACTOR_BACKEND_URL__: JSON.stringify(
        process.env.REACTOR_BACKEND_URL ??
          (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8788'),
      ),
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // One instance of the runtime. Its React bindings hold a store, and two
      // copies means the application writes to one and reads the other.
      '@datalayer/reactor$': path.resolve(REACTOR, 'lib/index.js'),
      '@datalayer/reactor/react': path.resolve(REACTOR, 'lib/react/index.js'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  tools: {
    rspack: {
      module: {
        rules: [
          // `lib/` is ESM from `tsc`, with extensionless relative imports.
          {
            test: /\.m?js$/,
            include: [path.resolve(REACTOR, 'lib')],
            resolve: { fullySpecified: false },
          },
        ],
      },
    },
  },
  html: { title: 'Reactor CMS' },
  server: { port: 5181 },
});
