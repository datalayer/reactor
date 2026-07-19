/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import path from 'node:path';
import { searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';

type ResolverContext = {
  resolve: (
    id: string,
    importer?: string,
    options?: { skipSelf?: boolean }
  ) => Promise<{ id: string } | null>;
};

// The plugin packages ship TypeScript/TSX source (no build step). Alias them to
// their source entry points so the React plugin transforms them and a single
// copy of each is used across the monorepo.
export default {
  plugins: [
    // Mirror jupyter-react: convert Vite-incompatible `?text` imports
    // (e.g. service-worker assets) into `?raw` string imports.
    {
      name: 'fix-text-query',
      enforce: 'pre',
      async resolveId(
        this: ResolverContext,
        source: string,
        importer?: string
      ): Promise<string | null> {
        if (!source.includes('?text')) {
          return null;
        }
        const fixed = source.replace('?text', '?raw');
        const resolved: { id: string } | null = await this.resolve(fixed, importer, {
          skipSelf: true,
        });
        return resolved?.id ?? fixed;
      },
    },
    react({
      babel: {
        plugins: [
          [
            'babel-plugin-styled-components',
            {
              displayName: true,
              fileName: false,
            },
          ],
        ],
      },
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom', '@primer/react', 'styled-components', 'zustand'],
    alias: [
      // JupyterLab imports `*.raw.css` expecting a default string export.
      // Vite only provides that with `?raw`, so rewrite those requests.
      { find: /(.*\.raw\.css)$/, replacement: '$1?raw' },
      // Match jupyter-react: strip webpack-style `~` from CSS/package imports.
      { find: /^~(.*)$/, replacement: '$1' },
      { find: '@datalayer-examples/reactor-music-catalog-plugin', replacement: path.resolve(__dirname, '../catalog-plugin/src/index.tsx') },
      { find: '@datalayer-examples/reactor-music-checkout-plugin', replacement: path.resolve(__dirname, '../checkout-plugin/src/index.tsx') },
      { find: '@datalayer-examples/reactor-music-header-plugin', replacement: path.resolve(__dirname, '../header-plugin/src/index.tsx') },
      { find: '@datalayer-examples/reactor-music-shop-plugin', replacement: path.resolve(__dirname, '../shop-plugin/src/index.tsx') },
    ],
  },
  define: {
    // Match jupyter-react: avoid runtime ReferenceError in modules expecting
    // webpack's global public-path symbol.
    __webpack_public_path__: '""',
    global: 'globalThis',
    'process.env': {},
  },
  server: {
    port: 5179,
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
        path.resolve(__dirname, '../../../../../../node_modules'),
      ],
    },
  },
};
