import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The plugin packages ship TypeScript/TSX source (no build step). Alias them to
// their source entry points so the React plugin transforms them and a single
// copy of each is used across the monorepo.
export default defineConfig({
  plugins: [
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
  },
});
