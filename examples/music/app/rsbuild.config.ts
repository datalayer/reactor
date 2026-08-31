/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The music store, on Rsbuild.
 *
 * The other examples were a config swap. This one carried four things the Vite
 * config had to do, and they are the reason §2.2 of REACTOR.md called it the
 * hard one. Each is translated below with a note on what changed, because two
 * of them got *simpler* on Rspack and that is worth knowing when the next app
 * moves.
 *
 * @see ../../../REACTOR.md §2
 */

import path from 'node:path';

import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginStyledComponents } from '@rsbuild/plugin-styled-components';

const MUSIC = path.resolve(__dirname, '..');
const REACTOR = path.resolve(__dirname, '../../..');

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginStyledComponents({ displayName: true, fileName: false }),
  ],
  source: {
    entry: { index: './src/main.tsx' },
    define: {
      // Where the API is, when it is not this origin.
      //
      // Empty in a production build, because the Python host serves this bundle
      // from the same origin as the API — that is what makes
      // `datalayer-music-example` one command. Development is the split case:
      // Rsbuild here, uvicorn there.
      __REACTOR_BACKEND_URL__: JSON.stringify(
        process.env.REACTOR_BACKEND_URL ??
          (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:8799'),
      ),
      // Modules written for webpack expect this symbol to exist. On Rspack it
      // is no longer a lie — but the plugins are also built by Vite elsewhere,
      // so it stays declared rather than assumed.
      __webpack_public_path__: '""',
      global: 'globalThis',
      'process.env': JSON.stringify({}),
    },
  },
  resolve: {
    // Exactly one copy of each, whoever asks. A second React is a broken-hooks
    // error that names none of this, and a second `zustand` is two stores that
    // look like one.
    //
    // `@primer/react` is deliberately *not* in this list, though the Vite
    // config deduped it. Rsbuild implements dedupe as an alias on the bare
    // specifier, which then swallows `@primer/react/experimental` — a subpath
    // the Jupyter components reach for. One copy of Primer comes from the
    // workspace hoisting it; an alias that breaks its export map does not buy
    // anything the hoist has not already given.
    dedupe: ['react', 'react-dom', 'styled-components', 'zustand'],
    alias: {
      // Exactly one instance of the runtime, and of its React bindings.
      //
      // Not an optimisation. `@datalayer/reactor/react` holds a zustand store,
      // and the plugins reach it from their own places in a workspace tree — so
      // without this the application writes `isBackendPluginAvailable` into one
      // copy of that store and `ReactorSlot` reads it from another. Every slot
      // gated on a backend plugin then renders nothing, silently: no error, no
      // warning, just an empty store. Worth the two lines.
      '@datalayer/reactor$': path.resolve(REACTOR, 'lib/index.js'),
      '@datalayer/reactor/react': path.resolve(REACTOR, 'lib/react/index.js'),
      // The bundled plugins, for the same reason: the manager *offers* a
      // contribution point, and the example's panel fills it. Two copies of the
      // manager means the panel contributes to a point nothing is reading.
      '@datalayer/reactor-manager$': path.resolve(REACTOR, 'plugins/manager/lib/index.js'),
      '@datalayer/reactor-graph$': path.resolve(REACTOR, 'plugins/graph/lib/index.js'),
      // The plugin packages ship TSX source with no build step, so they are
      // aliased to their entry points — the same list `docs/docusaurus.config.js`
      // keeps for the embedded demo. The two are separate on purpose (the docs
      // site aliases all seven; here the workspace resolves the rest), but they
      // move together: changing a package's layout means changing both.
      '@datalayer-examples/reactor-music-catalog-core': path.resolve(MUSIC, 'catalog-core/src/index.ts'),
      '@datalayer-examples/reactor-music-catalog-plugin': path.resolve(MUSIC, 'catalog-plugin/src/index.tsx'),
      '@datalayer-examples/reactor-music-checkout-plugin': path.resolve(MUSIC, 'checkout-plugin/src/index.tsx'),
      '@datalayer-examples/reactor-music-header-plugin': path.resolve(MUSIC, 'header-plugin/src/index.tsx'),
      '@datalayer-examples/reactor-music-shop-plugin': path.resolve(MUSIC, 'shop-plugin/src/index.tsx'),
    },
  },
  tools: {
    rspack: {
      resolve: {
        // Something deep in the Datalayer client's dependency graph reaches a
        // Next.js internal that imports node builtins. Vite dropped those
        // silently; webpack and Rspack require an answer, and `false` is the
        // right one — this is a browser bundle, and a module that needs `fs`
        // here was never going to work.
        fallback: { fs: false, zlib: false, path: false, stream: false, crypto: false },
      },
      module: {
        rules: [
          // `lib/` is a `"type": "module"` package whose `tsc` output uses
          // extensionless relative imports. Rspack treats those as strict ESM
          // and refuses them; this is the standard opt-out, scoped to the one
          // package that needs it.
          {
            test: /\.m?js$/,
            include: [path.resolve(REACTOR, 'lib'), path.resolve(REACTOR, 'plugins')],
            resolve: { fullySpecified: false },
          },
          // JupyterLab ships `*.raw.css` and expects a default string export.
          // Vite needed the request rewritten to `?raw`; webpack and Rspack
          // have a module type for exactly this, so the rewrite goes away.
          { test: /\.raw\.css$/, type: 'asset/source' },
          // Service-worker assets are imported with `?text`. Same answer: match
          // the query and hand back the source, rather than rewriting the
          // specifier to something the bundler understands.
          { resourceQuery: /(\?|&)(text|raw)(&|$)/, type: 'asset/source' },
        ],
      },
    },
  },
  html: {
    title: 'Reactor Music',
  },
  server: {
    port: 5179,
  },
});
