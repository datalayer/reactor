/**
 * Builds the __NAME__ container straight into the wheel's `share/` directory,
 * so `npm run build` then `pip install .` ships both halves at one version.
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
    distPath: { root: '../share/datalayer/reactor/extensions/__NAME__' },
  },
});
