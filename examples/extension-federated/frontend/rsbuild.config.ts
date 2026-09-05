/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Builds the container straight into the wheel's `share/` directory.
 *
 * `distPath` is the only thing that differs from a standalone container: the
 * output lands where `hatch` picks it up as shared data, so `pip install .`
 * after `npm run build` ships both halves at one version — the coupling the
 * roadmap asked to make explicit rather than assumed.
 *
 * In development, `npm run dev` serves the same container on :5182 with hot
 * updates. Point `entry` at it (the Python side takes any URL) or call
 * `updateFederatedRemote('hello_federated', 'http://localhost:5182/remoteEntry.js')`
 * from the host, and edits to `src/plugin.tsx` arrive without a wheel rebuild.
 */

import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      name: 'hello_federated',
      exposes: { './plugin': './src/plugin.tsx' },
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
        '@datalayer/reactor': { singleton: true },
        '@datalayer/reactor/react': { singleton: true },
      },
      dts: true,
    }),
  ],
  source: { entry: { index: './src/plugin.tsx' } },
  server: { port: 5182 },
  output: {
    assetPrefix: 'auto',
    distPath: { root: '../share/datalayer/reactor/extensions/hello-federated' },
  },
});
