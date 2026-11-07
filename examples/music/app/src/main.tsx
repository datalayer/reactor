/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

import React from "react";
import { createRoot } from "react-dom/client";
import * as Reactor from "@datalayer/reactor";
import {
  bootstrapExtensions,
  setFederationRuntime,
  setReactorSharedModules,
  type FederationRuntime as ReactorFederationRuntime,
} from "@datalayer/reactor";
import * as ReactorReact from "@datalayer/reactor/react";
import * as FederationRuntime from "@module-federation/runtime";
import { ThemedProvider, useThemeStore } from "@datalayer/primer-addons";
import { CATALOG_BACKEND_URL } from "@datalayer-examples/reactor-music-catalog-plugin";
import App from "./App";

import "./styles.css";

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
  "@datalayer/reactor": Reactor,
  "@datalayer/reactor/react": ReactorReact,
});

/**
 * The Module Federation runtime, for extensions that ship a container.
 *
 * Reactor imports it lazily by its bare name so a host that never federates
 * never pays for it — but a bare name means nothing to a browser once this app
 * is bundled, so a host that does federate hands its own copy over. Without
 * it, every pip-installed container (the extension template's, decks') stays
 * listed and unloadable, saying it needs `@module-federation/runtime`.
 */
// Reactor types the four functions it calls, structurally and a little looser
// than the SDK declares them (an optional `requiredVersion`), hence the cast.
setFederationRuntime(FederationRuntime as unknown as ReactorFederationRuntime);

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
  // The server that listed the extension is the server serving it, and in
  // development that is another port — a different origin, which a remote
  // normally has to be allowed for by name. Writing this call *is* the name:
  // `CATALOG_BACKEND_URL` is in this file, not in anything the network said.
  // An entry the server points at some *third* origin is still refused.
  const remotes = await bootstrapExtensions(CATALOG_BACKEND_URL);

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <ThemedProvider useStore={useThemeStore}>
        <App remotes={remotes} />
      </ThemedProvider>
    </React.StrictMode>,
  );
}

void main();
