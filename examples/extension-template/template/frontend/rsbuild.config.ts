/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * Builds the __NAME__ container straight into the wheel's `share/` directory,
 * so `npm run build` then `pip install .` ships both halves at one version —
 * the version in this directory's package.json, which pyproject.toml reads too.
 */

import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      // Must match `remote_name` in the Python declaration.
      name: '__PACKAGE__',
      // Must match `entry` in the Python declaration. Named, because the
      // plugin's default is a hashed `static/js/__PACKAGE__.<hash>.js` that
      // nothing would find.
      filename: 'remoteEntry.js',
      // The key must match `module` in the Python declaration.
      exposes: { './plugin': './src/plugin.tsx' },
      // Borrowed from the host, never bundled: two Reacts means broken hooks.
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
  server: { port: 5183 },
  output: {
    assetPrefix: 'auto',
    // Emptied before each build, so the wheel carries this build's chunks and
    // none of the last one's. Outside this directory, so it has to be said.
    cleanDistPath: true,
    distPath: { root: '../share/datalayer/reactor/extensions/__NAME__' },
    // The build records the version it was built at, beside what it emitted.
    // The Python half checks it: a wheel whose frontend was built at another
    // version is refused, by name, instead of loaded.
    copy: [{ from: './package.json' }],
  },
});
