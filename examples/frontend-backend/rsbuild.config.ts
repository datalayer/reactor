/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The two-tier example, on Rsbuild.
 *
 * Rsbuild owns the HTML rather than reading an `index.html` from the project
 * root, so what was markup in that file is configuration here — the title and
 * the font links. The entry is declared rather than discovered, for the same
 * reason.
 *
 * @see ../../REACTOR.md §2 for why this repository is on Rsbuild at all.
 */

import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginStyledComponents } from '@rsbuild/plugin-styled-components';

export default defineConfig({
  plugins: [
    pluginReact(),
    // Primer draws with styled-components. `displayName` is what makes a
    // component in React DevTools say what it is rather than `styled.div`.
    pluginStyledComponents({ displayName: true, fileName: false }),
  ],
  source: {
    entry: { index: './src/main.tsx' },
  },
  html: {
    title: 'Datalayer Reactor Primer Demo',
    tags: [
      { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
      {
        tag: 'link',
        attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true },
      },
      {
        tag: 'link',
        attrs: {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&display=swap',
        },
      },
    ],
  },
  server: {
    port: 5178,
  },
});
