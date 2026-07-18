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
    dedupe: ['react', 'react-dom', '@primer/react', 'styled-components'],
    alias: {
      '@ecommerce/catalog-plugin': path.resolve(__dirname, '../catalog-plugin/src/index.tsx'),
      '@ecommerce/header-plugin': path.resolve(__dirname, '../header-plugin/src/index.tsx'),
      '@ecommerce/shop-plugin': path.resolve(__dirname, '../shop-plugin/src/index.tsx'),
    },
  },
  server: {
    port: 5179,
  },
});
