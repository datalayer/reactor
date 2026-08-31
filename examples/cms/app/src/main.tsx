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

import * as UI from './ui';
import App from './App';
import './styles.css';

/**
 * What a plugin may borrow from this application.
 *
 * The first three are the floor every host publishes. The fourth is the
 * interesting one: **this host publishes its design system**, so a plugin that
 * wants to draw a panel draws with shadcn/ui components it never installed, in
 * this application's theme, without knowing what the kit is.
 *
 * That is the answer to "is the plugin model independent of the UI kit?". Not
 * "plugins avoid the kit" — some of them need to draw — but "the kit is
 * something the host hands over, so the same plugin works in a host that hands
 * over a different one".
 */
setReactorSharedModules({
  react: React,
  '@datalayer/reactor': Reactor,
  '@datalayer/reactor/react': ReactorReact,
  '@cms/ui': UI,
});

/**
 * Ask the server what is installed, then start.
 *
 * Every plugin in this CMS arrives this way. Nothing below is bundled: install
 * `cms-pro` beside the server and three more plugins appear in the same three
 * points on the next refresh, with no rebuild of this application.
 */
async function main() {
  const backend = window.location.origin;
  const remotes = await bootstrapExtensions(backend, { allowedOrigins: [backend] });

  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App remotes={remotes} />
    </React.StrictMode>,
  );
}

void main();
