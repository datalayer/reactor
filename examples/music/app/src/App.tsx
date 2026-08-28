/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React from 'react';
import { buildReactorFromExtensions } from '@datalayer/reactor';
import { ReactorSlot, useReactor } from '@datalayer/reactor/react';
import { Box } from '@datalayer/primer-addons';
import { HeaderExtension } from '@datalayer-examples/reactor-music-header-plugin';
import { ShopExtension } from '@datalayer-examples/reactor-music-shop-plugin';
import { useCheckout } from '@datalayer-examples/reactor-music-checkout-plugin';
import { MoodExtension } from '@datalayer-examples/reactor-music-mood-plugin';
import {
  PluginsPanelExtension,
  useBackendPluginAvailability,
} from '@datalayer-examples/reactor-music-plugins-panel-plugin';

// The app is purely declarative: it only mounts plugins. The base catalog
// plugin, the checkout plugin and the playlist plugin are pulled in
// automatically as dependencies, and each contributes its own UI to a slot.
//
// `MoodExtension` is mounted for its *contributions* rather than for any UI: it
// renders nothing, and everything it offers reaches the screen through the
// playlist plugin's extension point.
const reactor = buildReactorFromExtensions([
  HeaderExtension,
  ShopExtension,
  MoodExtension,
  PluginsPanelExtension,
]);

function Content() {
  // When checkout is open, the checkout page replaces the main store view.
  const checkingOut = useCheckout((state) => state.open);
  return (
    <Box
      sx={{
        maxWidth: 960,
        mx: 'auto',
        px: 3,
        py: 4,
        display: 'grid',
        gap: 4,
      }}
    >
      {/* Outside the checkout branch: the panel is how you switch plugins back
          on, so it must not be one of the things that disappears. */}
      <ReactorSlot slot="plugins" />
      {checkingOut ? (
        <ReactorSlot slot="checkout" />
      ) : (
        <>
          <ReactorSlot slot="catalog" />
          <ReactorSlot slot="playlist" />
          <ReactorSlot slot="main" />
        </>
      )}
    </Box>
  );
}

export default function App() {
  // Which backend plugins are available is the server's answer, not a constant:
  // the Plugins panel toggles them over the reactor's management API, and every
  // slot gated on `requiredBackendPlugins` follows.
  const isBackendPluginAvailable = useBackendPluginAvailability();
  useReactor(reactor, { isBackendPluginAvailable });
  return (
    <>
      <ReactorSlot slot="header" />
      <Content />
    </>
  );
}
