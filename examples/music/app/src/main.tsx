/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import * as Reactor from '@datalayer/reactor';
import { bootstrapExtensions, setReactorSharedModules } from '@datalayer/reactor';
import * as ReactorReact from '@datalayer/reactor/react';
import { ThemedProvider, setupPrimerPortals, useThemeStore } from '@datalayer/primer-addons';
import { CATALOG_BACKEND_URL } from '@datalayer-examples/reactor-music-catalog-plugin';
import App from './App';

import './styles.css';

setupPrimerPortals();

/**
 * What a pip-installed plugin is allowed to borrow from this shell.
 *
 * A module fetched at runtime is not in this bundle, so it cannot `import
 * 'react'` and get *our* React — it would get a second one, whose hooks throw
 * from inside a component that looks perfectly fine. Publishing ours is the
 * fix, and the list is the application's to decide: a host with a design
 * system its plugins draw with should publish that too.
 */
setReactorSharedModules({
  react: React,
  '@datalayer/reactor': Reactor,
  '@datalayer/reactor/react': ReactorReact,
});

/**
 * Ask the server what is installed, then start.
 *
 * This is the browser end of "one `pip install`, both tiers". The server
 * rescans its entry points when asked, so an extension installed a minute ago
 * into a *running* uvicorn is in this answer — which makes a page refresh the
 * whole reload mechanism.
 *
 * Awaited before the first render rather than folded in afterwards, so the
 * plugin list is complete from the first frame: the manifests come from the
 * server, and the modules are still on the wire.
 */
async function main() {
  const remotes = await bootstrapExtensions(CATALOG_BACKEND_URL, {
    // The server that listed the extension is the server serving it, and it is
    // not this page's origin in development.
    allowedOrigins: [CATALOG_BACKEND_URL],
  });

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ThemedProvider useStore={useThemeStore}>
        <App remotes={remotes} />
      </ThemedProvider>
    </React.StrictMode>,
  );
}

void main();
