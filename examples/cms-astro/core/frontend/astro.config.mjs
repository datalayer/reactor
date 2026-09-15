import node from '@astrojs/node';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  vite: {
    // JupyterLab styles still use webpack's `~package/path` import convention.
    // Match the compatibility alias used by the Jupyter Vite examples.
    resolve: {
      alias: [{ find: /^~(.*)$/, replacement: '$1' }],
    },
    // Some transitive Jupyter plugins import their WebAssembly modules as
    // assets. Without this, Vite interprets them as unsupported ESM Wasm.
    assetsInclude: ['**/*.wasm', '**/*.raw.css'],
    define: {
      global: 'globalThis',
      __webpack_public_path__: '""',
      'process.env': {},
    },
    optimizeDeps: {
      esbuildOptions: {
        target: 'esnext',
      },
      include: ['react', 'react-dom'],
    },
  },
});
