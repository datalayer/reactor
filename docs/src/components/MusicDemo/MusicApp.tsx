/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/*
 * Copyright (c) 2025-2026 Datalayer, Inc.
 * Distributed under the terms of the Modified BSD License.
 */

/**
 * The music example, running on this page.
 *
 * This is the example's own `app/src/App.tsx` with two differences, and no
 * third: the plugin sources are imported unchanged, and every behaviour the
 * page describes is the real runtime doing it.
 *
 * 1. **No router.** The example has a `/graph` address for the plugin graph;
 *    a documentation page cannot take over the URL bar, so the graph plugin is
 *    left out here and documented on its own page instead.
 * 2. **No uvicorn.** `installMockBackend` answers the four backend plugins'
 *    endpoints in the browser, so the Python half of the Plugins panel is live
 *    rather than a screenshot.
 *
 * @see /examples/music for what this is a copy of.
 */

import React, { useEffect, useRef, useState } from 'react';
import { buildReactorFromPlugins, defineExtension, defineLazyPlugin, onContributionPoint } from '@datalayer/reactor';
import { ReactorSlot, useReactor, useSlotComponents } from '@datalayer/reactor/react';
import { Box, ThemedProvider, useThemeStore, setupPrimerPortals } from '@datalayer/primer-addons';
import { PluginsManagerPlugin } from '@datalayer/reactor-manager';
import { HeaderPlugin } from '@datalayer-examples/reactor-music-header-plugin';
import { ShopPlugin } from '@datalayer-examples/reactor-music-shop-plugin';
import { CheckoutPlugin, useCheckout } from '@datalayer-examples/reactor-music-checkout-plugin';
import { PlaylistPlugin } from '@datalayer-examples/reactor-music-playlist-plugin';
import {
  PluginsPanelPlugin,
  useBackendPluginAvailability,
} from '@datalayer-examples/reactor-music-plugins-panel-plugin';

import { installMockBackend } from './backend';

// Before the first `useCatalogSongs` runs, and before the panel asks the
// platform what it is running. Installing it at module scope rather than in an
// effect is what keeps the first fetch from racing the shim.
installMockBackend();

// Primer's overlays render in a portal at the document root, which is outside
// this component's theme provider. This is what themes them.
setupPrimerPortals();

/**
 * Declarations the Datalayer theme provider writes onto `<body>`.
 *
 * Not the CSS custom properties it writes alongside them — those are named
 * `--fgColor-…`, `--text-…`, `--bgColor-…`, they collide with nothing
 * Docusaurus uses, and the portals genuinely need them: an overlay renders at
 * the document root, outside every provider, and inherits its theme from the
 * body it lands in.
 *
 * These six are the ones that are not tokens but *appearance*, and they change
 * the page around the demo.
 */
const LEAKED_ONTO_BODY = [
  'font-family',
  'font-size',
  'background-color',
  'color',
  '-webkit-font-smoothing',
  'text-rendering',
];

/**
 * Keep the store's theme off the documentation around it.
 *
 * `DatalayerThemeProvider` pushes its theme onto `document.body` so that
 * Primer's portals inherit it. That is right for an application that owns the
 * page — the music store, run on its own, is exactly that — and wrong for one
 * embedded in somebody else's: the font, background and text colour of every
 * page on this site changed, and because Docusaurus is a single-page
 * application, they stayed changed after navigating away.
 *
 * So the tokens are left alone and the six appearance declarations are removed
 * again. An observer rather than a one-off, because the provider rewrites them
 * whenever the theme is recomputed — including on hover, when the header's
 * overlay mounts a provider of its own.
 *
 * The alternative was to stop using `ThemedProvider` here, which would have
 * meant the demo no longer running the code the example runs. Better to leave
 * the example honest and pay for the embedding on this side.
 */
function keepTheStoreOutOfTheDocs(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const strip = () => {
    for (const property of LEAKED_ONTO_BODY) {
      if (document.body.style.getPropertyValue(property)) {
        // Removing mutates the attribute, which wakes this observer again —
        // and finds nothing left to remove, so it settles after one pass.
        document.body.style.removeProperty(property);
      }
    }
  };
  strip();
  new MutationObserver(strip).observe(document.body, {
    attributes: true,
    attributeFilter: ['style'],
  });
}

keepTheStoreOutOfTheDocs();

// Pinned, rather than left to the reader.
//
// The example's header contributes Datalayer's appearance controls — eight
// theme variants and a light/dark/auto switch — because it owns a whole
// viewport and may reasonably repaint it. Inside a documentation page it does
// not: the surrounding theme is Docusaurus's, and a store repainted in
// `matrix` green beside prose that stayed put reads as a bug rather than a
// choice.
//
// So the demo fixes the theme here and hides the control in `custom.css`
// (`.reactor-music-demo` scopes both). `auto` rather than a fixed mode: the
// reader's system preference is the one signal worth following, and it is the
// one the page around it follows too.
useThemeStore.getState().setTheme('datalayer', false);
useThemeStore.getState().setColorMode('auto');

/** Narrower than the example's 420: a docs page is not a whole viewport. */
const SIDEBAR_WIDTH = 320;

/**
 * Below this, the sidebar goes under the store instead of beside it.
 *
 * Measured against the frame rather than the viewport, which is the whole
 * point of {@link useFrameWidth}: this demo sits in a column whose width has
 * nothing to do with how wide the window is.
 */
const SIDEBAR_BESIDE = 720;

/**
 * The width of the element this demo is rendered into.
 *
 * The example's own app lays itself out from viewport breakpoints, because it
 * *is* the viewport. Here it is a box inside an article inside a documentation
 * theme, and a viewport breakpoint says nothing useful about how much room
 * that box has — a 1600px window can hand this frame 900px or 600px depending
 * on whether the page shows a table of contents. So it measures.
 */
function useFrameWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * The mood plugin, fetched after the first paint and only once something asks
 * for playlist rules — which is the playlist plugin rendering its chooser.
 *
 * Identical to the example's declaration. Everything the plugin list needs to
 * show it is declared here rather than inside the module, which is why it is
 * in the Plugins panel from the first frame.
 */
const MoodPlugin = defineLazyPlugin({
  name: '@music/mood',
  version: '1.0.0',
  displayName: 'Moods',
  description:
    'Three ways to fill a playlist, contributed to the playlist plugin. Renders nothing itself, and loads after the first paint.',
  octicon: 'sun',
  emoji: '🌤️',
  dependencies: [PlaylistPlugin],
  activationEvents: [onContributionPoint('music.playlistRule')],
  load: () =>
    import('@datalayer-examples/reactor-music-mood-plugin').then(module => module.MoodPlugin),
});

/** The store, as one installable thing. */
const StoreExtension = defineExtension({
  name: '@music/store',
  version: '1.0.0',
  displayName: 'Store',
  description: 'The shop view, the playlist beside it, and the moods that fill it.',
  octicon: 'package',
  emoji: '🛍️',
  plugins: [ShopPlugin, PlaylistPlugin, MoodPlugin, CheckoutPlugin],
});

// Module scope, like the example: one platform for the life of the page, so a
// plugin switched off in the panel stays off while the reader scrolls away and
// back. The catalog plugin is not listed — it arrives as the shop's dependency.
const reactor = buildReactorFromPlugins([
  HeaderPlugin,
  StoreExtension,
  PluginsManagerPlugin,
  PluginsPanelPlugin,
]);

function Content() {
  const checkingOut = useCheckout(state => state.open);
  // Asked rather than assumed: with the shop switched off there is no shop
  // column, and the rest closes the gap rather than sitting beside a hole.
  const hasShop = useSlotComponents('main').length > 0;
  const hasCheckout = useSlotComponents('checkout').length > 0;

  // One column, unlike the example, which puts the shop beside the catalog.
  // Two columns *plus* the plugins panel needs about 1100px before the shop's
  // own card grid starts overflowing its share, and no documentation page is
  // that wide. Stacking is the honest answer: the layout is the application's
  // decision, and this page is a different application.
  const sx = {
    px: 3,
    py: 4,
    display: 'grid',
    gap: 4,
    alignItems: 'start',
    minWidth: 0,
  } as const;

  if (checkingOut && hasCheckout) {
    return (
      <Box sx={sx}>
        {/* Each slot is boxed rather than rendered bare: `ReactorSlot` renders
            a fragment, so two plugins filling one slot would become two grid
            items instead of one. */}
        <Box sx={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <ReactorSlot slot="checkout" />
        </Box>
        <Box sx={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <ReactorSlot slot="checkout-aside" />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={sx}>
      {hasShop ? (
        <Box sx={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <ReactorSlot slot="main" />
        </Box>
      ) : null}
      <Box sx={{ display: 'grid', gap: 4, minWidth: 0 }}>
        <ReactorSlot slot="catalog" />
        <ReactorSlot slot="playlist" />
      </Box>
    </Box>
  );
}

/**
 * The right sidebar, whose contents are entirely contributed: the manager's
 * own list of frontend plugins, and the group of Python ones the example's
 * panel adds to it.
 */
function Sidebar({ beside }: { beside: boolean }) {
  return (
    <Box
      as="aside"
      sx={{
        width: beside ? SIDEBAR_WIDTH : '100%',
        flexShrink: 0,
        px: 3,
        py: 4,
        bg: 'canvas.subtle',
        borderLeft: beside ? '1px solid' : 'none',
        borderTop: beside ? 'none' : '1px solid',
        borderColor: 'border.default',
        alignSelf: 'stretch',
      }}
    >
      <ReactorSlot slot="sidebar" props={{ width: SIDEBAR_WIDTH }} />
    </Box>
  );
}

function Store({ beside }: { beside: boolean }) {
  const isBackendPluginAvailable = useBackendPluginAvailability();
  useReactor(reactor, { isBackendPluginAvailable });
  return (
    <>
      <ReactorSlot slot="header" />
      <Box
        sx={{
          display: 'flex',
          flexDirection: beside ? 'row' : 'column',
          alignItems: 'flex-start',
        }}
      >
        <Box sx={{ flex: '1 1 auto', minWidth: 0, width: '100%' }}>
          <Content />
        </Box>
        <Sidebar beside={beside} />
      </Box>
    </>
  );
}

/**
 * The demo, framed.
 *
 * The border is the page's contribution, not the example's: a live application
 * inside a paragraph of prose needs an edge, or the reader cannot tell where
 * the documentation stops and the running thing starts.
 *
 * What the frame deliberately does *not* have is a height. A capped, scrolling
 * box puts the store's own scrollbar next to the page's, and then reaching the
 * playlist means scrolling the right one — while the plugin switches that
 * explain the playlist have gone off the top of the inner box. Left to its
 * natural height everything is on screen at once and the page scrolls, which is
 * the scrollbar the reader already has.
 */
export default function MusicApp() {
  const [ref, width] = useFrameWidth();
  // Until the first measurement lands, assume there is room: a frame that
  // starts stacked and jumps sideways is worse than one that starts wide.
  const beside = width === 0 || width >= SIDEBAR_BESIDE;

  return (
    <ThemedProvider useStore={useThemeStore}>
      <Box
        ref={ref}
        className="reactor-music-demo"
        sx={{
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          // No height, and no `overflow` to go with it. Horizontal overflow is
          // handled by laying out to the measured frame width rather than by a
          // scrollbar, and `visible` is what lets the header's cart overlay
          // hang past the edge instead of being clipped by its own frame.
          bg: 'canvas.default',
          color: 'fg.default',
        }}
      >
        <Store beside={beside} />
      </Box>
    </ThemedProvider>
  );
}
