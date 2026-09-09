/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The Charts plugin as a Module Federation container — the built way.
 *
 * `public/remotes/charts/remoteEntry.js` in the parent example is this same
 * container written by hand, so the protocol can be read. This is what emits
 * one for real, and the three fields are the whole configuration:
 *
 * - `name` is what a host registers the container under — `scope` on
 *   `defineFederatedPlugin`.
 * - `exposes` maps the module a host asks for (`./plugin`) to a source file.
 * - `shared` is what the container will *borrow* rather than bundle. React
 *   and the reactor are singletons: two copies of either and hooks throw from
 *   inside a component that looks fine. `requiredVersion` states what this
 *   container was built against, and the host answers it by version — which
 *   is the negotiation a plain `import()` could never have.
 *
 * `dts: true` writes the remote's type hints (`@mf-types`) beside the build,
 * which a host consuming this container gets `loadRemote<…>()` typed against.
 */

import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      name: 'reactor_charts',
      exposes: {
        './plugin': './src/plugin.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
        '@datalayer/reactor': { singleton: true },
        '@datalayer/reactor/react': { singleton: true },
      },
      dts: true,
    }),
  ],
  // A container has no page of its own; the entry is the plugin.
  source: { entry: { index: './src/plugin.tsx' } },
  server: { port: 5181 },
  output: {
    // Absolute, so the chunks the entry pulls in resolve from wherever the
    // container is served — the host's origin, a CDN, or `share/` in a wheel.
    assetPrefix: 'auto',
  },
});
