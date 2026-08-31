/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/*
 * Copyright (c) 2025-2026 Datalayer, Inc.
 * Distributed under the terms of the Modified BSD License.
 */

const path = require('node:path');

/** The reactor repository root, one level above this site. */
const REPO = path.resolve(__dirname, '..');
/** Where the music example's plugin packages live. */
const MUSIC = path.resolve(REPO, 'examples/music');

/**
 * Everything the embedded music demo needs webpack to know.
 *
 * The example is a set of npm workspaces that ship TSX source rather than a
 * build, and it is consumed here from outside the site directory. Three things
 * follow from that, and this plugin is all three:
 *
 * 1. **Aliases to source.** Each `@datalayer-examples/reactor-music-*` package
 *    resolves to its `src/index.tsx`, exactly as the example's own
 *    `vite.config.ts` does. The demo therefore documents the example as it is
 *    written; there is no forked copy of it in this repository.
 * 2. **One copy of everything shared.** React, Primer and styled-components
 *    are aliased to this site's `node_modules` so that a plugin resolving them
 *    from its own place in the tree cannot end up with a second React — which
 *    is a broken hooks error rather than a duplicated byte.
 * 3. **A loader for that source.** Docusaurus compiles `siteDir/src`; these
 *    files are outside it, so they get the same JS loader pointed at them.
 */
function reactorMusicDemo() {
  return {
    name: 'reactor-music-demo',
    configureWebpack(_config, isServer) {
      const shared = name => ({ [name]: path.resolve(__dirname, 'node_modules', name) });
      return {
        resolve: {
          alias: {
            // The demo itself, under one name so that the server build can be
            // given nothing for it. `<MusicDemo />` is wrapped in
            // `BrowserOnly` and never renders during a prerender, and the
            // example builds its platform at module scope and reaches for
            // `window` — so there is nothing for SSR to gain by compiling it,
            // and a whole design system's worth of modules to lose.
            '@reactor-music-demo': isServer
              ? false
              : path.resolve(__dirname, 'src/components/MusicDemo/MusicApp.tsx'),
            // The example's plugins, from source.
            '@datalayer-examples/reactor-music-catalog-plugin': path.resolve(MUSIC, 'catalog-plugin/src/index.tsx'),
            '@datalayer-examples/reactor-music-checkout-plugin': path.resolve(MUSIC, 'checkout-plugin/src/index.tsx'),
            '@datalayer-examples/reactor-music-header-plugin': path.resolve(MUSIC, 'header-plugin/src/index.tsx'),
            '@datalayer-examples/reactor-music-mood-plugin': path.resolve(MUSIC, 'mood-plugin/src/index.tsx'),
            '@datalayer-examples/reactor-music-playlist-plugin': path.resolve(MUSIC, 'playlist-plugin/src/index.tsx'),
            '@datalayer-examples/reactor-music-plugins-panel-plugin': path.resolve(MUSIC, 'plugins-panel-plugin/src/index.tsx'),
            '@datalayer-examples/reactor-music-shop-plugin': path.resolve(MUSIC, 'shop-plugin/src/index.tsx'),
            // The runtime and the manager, from source as well. Reading
            // `lib/` would work in a browser but not here: `tsc` emits
            // extensionless relative imports into an ESM package, which
            // webpack refuses to resolve as strict ESM. Source also means this
            // site builds without the runtime having been built first.
            '@datalayer/reactor$': path.resolve(REPO, 'src/index.ts'),
            '@datalayer/reactor/react': path.resolve(REPO, 'src/react/index.ts'),
            '@datalayer/reactor-manager$': path.resolve(REPO, 'plugins/manager/src/index.tsx'),
            // One generated avatar is not worth the whole Datalayer client.
            '@datalayer/core/lib/components/avatars': path.resolve(__dirname, 'src/shims/datalayer-core-avatars.tsx'),
            // Exactly one copy of each, whoever asks and from wherever.
            ...shared('react'),
            ...shared('react-dom'),
            ...shared('zustand'),
            ...shared('styled-components'),
            ...shared('boring-avatars'),
            ...shared('@primer/octicons-react'),
            ...shared('@datalayer/primer-addons'),
            '@primer/react$': path.resolve(__dirname, 'node_modules/@primer/react'),
          },
        },
      };
    },
  };
}

/** @type {import('@docusaurus/types').DocusaurusConfig} */
module.exports = {
  title: '🌀 Reactor',
  tagline: 'Extensible frontends and backends, from one plugin model',
  url: 'https://reactor.datalayer.tech',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  favicon: 'img/favicon.ico',
  organizationName: 'datalayer',
  projectName: 'datalayer',
  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
    // `.md` is CommonMark and `.mdx` is MDX. Without this every stray `{` or
    // `<` in prose is a build failure, which is a poor trade for pages that
    // want no components at all.
    format: 'detect',
  },
  plugins: [
    '@docusaurus/theme-live-codeblock',
    'docusaurus-lunr-search',
    reactorMusicDemo,
  ],
  themes: [
    '@docusaurus/theme-mermaid',
  ],
  themeConfig: {
    colorMode: {
      defaultMode: 'light',
      disableSwitch: true,
    },
    navbar: {
      title: 'Reactor',
      logo: {
        alt: 'Datalayer Logo',
        src: 'img/datalayer/logo.svg',
      },
      items: [
        {
          to: '/',
          label: 'Docs',
          position: 'left',
          activeBaseRegex: '^/$',
        },
        {
          to: '/examples/music/demo',
          label: 'Live demo',
          position: 'left',
        },
        {
          to: '/roadmap/',
          label: 'Roadmap',
          position: 'left',
        },
        {
          href: 'https://discord.gg/YQFwvmSSuR',
          position: 'right',
          className: 'header-discord-link',
          'aria-label': 'Discord',
        },
        {
          href: 'https://github.com/datalayer',
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub',
        },
        {
          href: 'https://bsky.app/profile/datalayer.ai',
          position: 'right',
          className: 'header-bluesky-link',
          'aria-label': 'Bluesky',
        },
        {
          href: 'https://x.com/DatalayerIO',
          position: 'right',
          className: 'header-x-link',
          'aria-label': 'X',
        },
        {
          href: 'https://www.linkedin.com/company/datalayer',
          position: 'right',
          className: 'header-linkedin-link',
          'aria-label': 'LinkedIn',
        },
        {
          href: 'https://tiktok.com/@datalayerio',
          position: 'right',
          className: 'header-tiktok-link',
          'aria-label': 'TikTok',
        },
        {
          href: 'https://www.youtube.com/@datalayer',
          position: 'right',
          className: 'header-youtube-link',
          'aria-label': 'YouTube',
        },
        {
          href: 'https://datalayer.ai',
          position: 'right',
          className: 'header-datalayer-io-link',
          'aria-label': 'Datalayer',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Reactor',
              to: '/',
            },
            {
              label: 'TypeScript runtime',
              to: '/typescript/plugins',
            },
            {
              label: 'Python runtime',
              to: '/python/plugins',
            },
            {
              label: 'Music example',
              to: '/examples/music/',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/datalayer/reactor',
            },
            {
              label: 'Bluesky',
              href: 'https://bsky.app/profile/datalayer.ai',
            },
            {
              label: 'LinkedIn',
              href: 'https://www.linkedin.com/company/datalayer',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Datalayer AI',
              href: 'https://datalayer.ai',
            },
            {
              label: 'Datalayer App',
              href: 'https://datalayer.app',
            },
            {
              label: 'Datalayer Docs',
              href: 'https://docs.datalayer.app',
            },
            {
              label: 'Datalayer Blog',
              href: 'https://datalayer.blog',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Datalayer, Inc.`,
    },
  },
  presets: [
    [
      '@docusaurus/preset-classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: require.resolve('./sidebars.js'),
          docItemComponent: '@theme/CustomDocItem',
          editUrl: 'https://github.com/datalayer/reactor/edit/main/docs/',
        },
        // There is no blog. Left on, the classic preset publishes an empty
        // one at /blog with a feed nobody writes to.
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      },
    ],
  ],
};
