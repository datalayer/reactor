/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildReactorFromPlugins,
  type ReactorExtension,
  defineExtension,
  defineLazyPlugin,
  onContributionPoint,
  type LazyPluginRef,
} from "@datalayer/reactor";
import {
  ReactorSlot,
  useBackendPluginStream,
  useReactor,
  useSlotComponents,
} from "@datalayer/reactor/react";
import { Box } from "@datalayer/primer-addons";
import { HeaderPlugin } from "@datalayer-examples/reactor-music-header-plugin";
import { ShopPlugin } from "@datalayer-examples/reactor-music-shop-plugin";
import {
  CheckoutPlugin,
  useCheckout,
} from "@datalayer-examples/reactor-music-checkout-plugin";
import { PlaylistPlugin } from "@datalayer-examples/reactor-music-playlist-plugin";
import {
  PluginsPanelPlugin,
  useBackendPluginAvailability,
  useBackendPlugins,
} from "@datalayer-examples/reactor-music-plugins-panel-plugin";
// The generic manager from the repo's `plugins/` folder: it lists this
// platform's frontend plugins and switches them, and knows nothing about a
// music store. The example's own panel keeps the half it cannot know — the
// Python plugins on the other side of the wire.
import { PluginsManagerPlugin } from "@datalayer/reactor-manager";

/** How wide the sidebar is, and what the manager truncates to. */
const SIDEBAR_WIDTH = 420;
import { CATALOG_BACKEND_URL } from "@datalayer-examples/reactor-music-catalog-plugin";
// Not one of this example's plugins: a reusable one from the repo's `plugins/`
// folder, installed like anything else. It knows nothing about a music store.
import { GraphPlugin, GRAPH_TOGGLE_EVENT } from "@datalayer/reactor-graph";
import { CommandsPlugin } from "@datalayer/reactor-commands";
// By path, not from the main barrel: the barrel-free corner is what keeps
// reactor out of primer-addons consumers that have none.
import { ThemePlugin } from "@datalayer/primer-addons/lib/reactor";

/**
 * The whole router, because the example needs exactly two addresses.
 *
 * A router dependency for one route would be the largest thing in this app and
 * would teach nothing about the reactor. `pushState` plus `popstate` is the
 * same contract at a hundredth of the size; vite's dev server already serves
 * `index.html` for unknown paths, so a reload on /graph works.
 */
function usePathname(): string {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  return pathname;
}

function navigate(to: string): void {
  if (window.location.pathname === to) {
    return;
  }
  window.history.pushState({}, "", to);
  // `pushState` does not fire `popstate`; this is what tells the app it moved.
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/**
 * The mood plugin, fetched after the first paint.
 *
 * Nothing on screen waits for it: the store and an empty playlist render, the
 * module arrives, and the playlist's rule chooser fills in. That is the whole
 * point of a lazy plugin — and it is a fair candidate because it renders no
 * UI of its own, so its absence costs a chooser rather than a page.
 *
 * Everything the sidebar needs to list and describe it is declared here, so it
 * appears in the plugin list from the first frame rather than popping in when
 * its module lands. `dependencies` is declared for the same reason: ordering
 * cannot wait for a module to arrive.
 *
 * It waits on an activation event rather than loading at startup, and the
 * event is the playlist's own rule point: the module is fetched the moment
 * anything reads the rules, which is when the playlist first renders its
 * chooser. Nobody had to name this plugin to cause that — the playlist asks
 * what rules exist, and the answer arrives.
 */
const MoodPlugin = defineLazyPlugin({
  name: "@music/mood",
  version: "1.0.0",
  displayName: "Moods",
  description:
    "Three ways to fill a playlist, contributed to the playlist plugin. Renders nothing itself, and loads after the first paint.",
  octicon: "sun",
  emoji: "🌤️",
  dependencies: [PlaylistPlugin],
  activationEvents: [onContributionPoint("music.playlistRule")],
  load: () =>
    import("@datalayer-examples/reactor-music-mood-plugin").then(
      (module) => module.MoodPlugin,
    ),
});

/**
 * The store, as one installable thing.
 *
 * Four plugins that are only useful together: the shop view, the playlist
 * beside it, the moods that fill the playlist, and the checkout that turns a
 * cart into an order. Grouping them says so — the sidebar lists them under one
 * heading and the graph draws one package delivering four plugins — without
 * changing what any of them can do. Each is still switched off on its own,
 * because grouping is about delivery, not governance.
 *
 * The checkout plugin is mounted here rather than arriving as somebody's
 * dependency. It used to be pulled in by the header, which imported its button
 * and drew it — so switching checkout off left a button opening a page that
 * was gone. Now the header offers a `cart-actions` slot and the checkout
 * plugin fills it, which means nothing depends on checkout, which means the
 * application has to install it on purpose. That is the right answer: it is a
 * capability of this store, not an implementation detail of its header.
 *
 * The catalog plugin is deliberately *not* here: it arrives as a dependency of
 * the shop, and a package should not claim to deliver what it merely relies on.
 */
const StoreExtension = defineExtension({
  name: "@music/store",
  version: "1.0.0",
  displayName: "Store",
  description:
    "The shop view, the playlist beside it, and the moods that fill it.",
  octicon: "package",
  emoji: "🛍️",
  plugins: [ShopPlugin, PlaylistPlugin, MoodPlugin, CheckoutPlugin],
});

// The app is purely declarative: it only mounts plugins and extensions. The
// base catalog plugin and the checkout plugin are pulled in automatically as
// dependencies, and each contributes its own UI to a slot.
//
// `MoodPlugin` is mounted for its *contributions* rather than for any UI: it
// renders nothing, and everything it offers reaches the screen through the
// playlist plugin's contribution point.
/**
 * The platform, built once the shell knows what is installed on the server.
 *
 * `remotes` are the plugins that arrived with a `pip install` rather than with
 * this application's bundle — see `main.tsx`. They go into the same list as
 * everything else, because a remote plugin is not a second kind of plugin: it
 * is a lazy plugin whose module happens to be at a URL.
 */
function createReactor(remotes: (LazyPluginRef | ReactorExtension)[]) {
  return buildReactorFromPlugins([
    HeaderPlugin,
    StoreExtension,
    PluginsManagerPlugin,
    PluginsPanelPlugin,
    GraphPlugin,
    CommandsPlugin,
    // The portal root and its color mode, followed from the theme store —
    // the two lines main.tsx used to hand-roll, plus the toggle command.
    ThemePlugin,
    ...remotes,
  ]);
}

function Content({ pathname }: { pathname: string }) {
  // When checkout is open, the checkout page replaces the main store view.
  const checkingOut = useCheckout((state) => state.open);
  // The graph plugin is generic, so this application tells it the two things
  // only this application knows: where its backend is, and which backend
  // plugins are on. Handing over the panel's own list rather than letting the
  // graph fetch its own is what keeps the graph and the switches in agreement.
  const backendPlugins = useBackendPlugins((state) => state.plugins);
  // The shop is switchable from the sidebar, so its column is a state this
  // layout has to have an answer for. Asking the slot what is in it is the
  // answer: with the shop off there is no first column, and what is left
  // takes the whole width rather than sitting beside a hole.
  const hasShop = useSlotComponents("main").length > 0;
  // Asked rather than assumed, for the same reason. Switching the checkout
  // plugin off while its page is open would otherwise leave two empty columns
  // and no way back to the store — the `open` flag lives in the plugin's
  // store, but the page that reads it has gone.
  const hasCheckout = useSlotComponents("checkout").length > 0;

  if (pathname === "/graph") {
    // No width cap: the graph is four columns of nodes and every pixel it is
    // denied is a label that wraps or an edge that crosses another.
    return (
      <Box sx={{ px: 3, py: 4, display: "grid", gap: 3 }}>
        <ReactorSlot
          slot="graph"
          props={{ backendUrl: CATALOG_BACKEND_URL, backendPlugins }}
        />
      </Box>
    );
  }
  if (checkingOut && hasCheckout) {
    // The same two columns as the store, so the page does not jump when the
    // shopper crosses into checkout — but the store's contents are gone from
    // both. Checkout is a decision, and a catalog beside it is a place to lose
    // the thread.
    return (
      <Box
        sx={{
          px: 3,
          py: 4,
          display: "grid",
          gridTemplateColumns: ["1fr", "1fr", "minmax(0, 1fr) minmax(0, 1fr)"],
          alignItems: "start",
          gap: 4,
        }}
      >
        {/* Each column is a box of its own, not a bare slot. `ReactorSlot`
            renders a fragment, so a slot filled by two plugins would put two
            children straight into the grid — and the second would land in the
            next column. Wrapping keeps a slot's contents in one column
            however many plugins fill it. */}
        <Box sx={{ display: "grid", gap: 4, minWidth: 0 }}>
          <ReactorSlot slot="checkout" />
        </Box>
        {/* Whatever the checkout plugin wants beside its page — which of its
            two views is on screen is its business, not this layout's. */}
        <Box sx={{ display: "grid", gap: 4, minWidth: 0 }}>
          <ReactorSlot slot="checkout-aside" />
        </Box>
      </Box>
    );
  }
  return (
    <Box
      sx={{
        px: 3,
        py: 4,
        display: "grid",
        // One column until there is room for two. `minmax(0, 1fr)` rather than
        // `1fr`: a grid track's default minimum is its content, so a wide
        // child — the catalog's own inner grid — would push the column past
        // its share and the whole page would scroll sideways.
        gridTemplateColumns: hasShop
          ? ["1fr", "1fr", "minmax(0, 1fr) minmax(0, 1fr)"]
          : "1fr",
        alignItems: "start",
        gap: 4,
      }}
    >
      {/* The shop is the thing being used; the catalog and the playlist are
          what it is used on. Giving the shop a column of its own means the
          cart stays in view while you scroll the other two. */}
      {hasShop ? (
        // Boxed for the same reason as the checkout columns: a slot renders a
        // fragment, and two plugins filling `main` would otherwise become two
        // grid items in two different columns.
        <Box sx={{ display: "grid", gap: 4, minWidth: 0 }}>
          <ReactorSlot slot="main" />
        </Box>
      ) : null}
      <Box sx={{ display: "grid", gap: 4, minWidth: 0 }}>
        <ReactorSlot slot="catalog" />
        <ReactorSlot slot="playlist" />
      </Box>
    </Box>
  );
}

/**
 * The right sidebar.
 *
 * Outside the checkout branch on purpose: the sidebar is how a plugin gets
 * switched back on, so it must not be one of the things that disappears. It
 * sticks while the store scrolls, so a switch and what it changes stay in the
 * same view.
 *
 * Its contents are entirely contributed. This application used to draw the
 * "View plugin graph" button here, which meant the button survived switching
 * the graph plugin off and led to an empty page; it belongs to that plugin and
 * now arrives with it. What this still owns is routing — only the application
 * knows it has a `/graph` address — so it hands that down and the plugins that
 * need it take what they recognise.
 */
function Sidebar({ pathname }: { pathname: string }) {
  const onGraph = pathname === "/graph";

  const toggleGraph = useCallback(
    () => navigate(onGraph ? "/" : "/graph"),
    [navigate, onGraph],
  );
  // The graph plugin's palette command cannot be handed `onToggleGraph`, so it
  // asks through an event instead. Answering it here keeps one way to open the
  // graph, whether it came from the button or from Ctrl-K.
  useEffect(() => {
    function answer(event: Event) {
      // Claiming it is how the command knows a host is listening: unclaimed,
      // it throws rather than doing nothing.
      event.preventDefault();
      toggleGraph();
    }
    window.addEventListener(GRAPH_TOGGLE_EVENT, answer);
    return () => window.removeEventListener(GRAPH_TOGGLE_EVENT, answer);
  }, [toggleGraph]);

  return (
    <Box
      as="aside"
      sx={{
        // Wide enough for a plugin's name, its description and a switch on
        // one line. The manager truncates its descriptions to the width it is
        // given, so the two are the same number on purpose.
        width: ["100%", "100%", SIDEBAR_WIDTH],
        flexShrink: 0,
        px: 3,
        py: 4,
        bg: "canvas.subtle",
        borderLeft: ["none", "none", "1px solid"],
        borderTop: ["1px solid", "1px solid", "none"],
        borderColor: "border.default",
        alignSelf: "stretch",
        position: ["static", "static", "sticky"],
        top: 0,
        maxHeight: ["none", "none", "100vh"],
        overflowY: ["visible", "visible", "auto"],
      }}
    >
      <ReactorSlot
        slot="sidebar"
        props={{
          width: SIDEBAR_WIDTH,
          showingGraph: onGraph,
          onToggleGraph: toggleGraph,
        }}
      />
    </Box>
  );
}

export default function App({
  remotes = [],
}: {
  // What `bootstrapExtensions` hands back: plugin refs, and the extension
  // groups that deliver several at once.
  remotes?: (LazyPluginRef | ReactorExtension)[];
}) {
  // Which backend plugins are available is the server's answer, not a constant:
  // the Plugins panel toggles them over the reactor's management API, and every
  // slot gated on `requiredBackendPlugins` follows.
  const isBackendPluginAvailable = useBackendPluginAvailability();
  // `remotes` is built once, before the first render, so this memo runs once —
  // rebuilding the platform on a re-render would restart every plugin in it.
  const reactor = useMemo(() => createReactor(remotes), [remotes]);
  useReactor(reactor, { isBackendPluginAvailable });
  // Follow the Python tier, so switching a backend plugin off does not merely
  // stop its slots drawing — it stands the frontend plugins that need it down,
  // and brings them back when it returns. Untick `catalog` in the panel and the
  // shop's rows leave the plugin list as *deactivated*, not merely blank.
  useBackendPluginStream(CATALOG_BACKEND_URL);
  const pathname = usePathname();
  return (
    <>
      {/* Rendered once, for plugins that need a mount point but position
          themselves — the command palette floats over everything from here. */}
      <ReactorSlot slot="root" />
      <ReactorSlot slot="header" />
      <Box
        sx={{
          display: "flex",
          flexDirection: ["column", "column", "row"],
          alignItems: "flex-start",
        }}
      >
        <Box sx={{ flex: "1 1 auto", minWidth: 0 }}>
          <Content pathname={pathname} />
        </Box>
        <Sidebar pathname={pathname} />
      </Box>
    </>
  );
}
