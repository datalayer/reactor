/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The CMS, running on this page — including the install.
 *
 * The example's own `App.tsx` is imported unchanged; what this file adds is the
 * part a documentation page can show that a screenshot cannot: a **package
 * manager**. The button runs `pipInstall('cms-pro')`, which does to the
 * in-browser host exactly what `pip install cms-pro` does to a real one — adds
 * a distribution to the environment.
 *
 * Everything after that is the real runtime. The host rescans, answers with
 * three more manifests, the shell builds remote plugin references from them,
 * fetches the module, and three plugins appear in three points that already
 * existed. Nothing in the CMS application changes, and nothing in it is
 * rebuilt.
 */

import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { bootstrapExtensions, setReactorSharedModules } from '@datalayer/reactor';
import * as Reactor from '@datalayer/reactor';
import * as ReactorReact from '@datalayer/reactor/react';
import type { LazyPluginRef } from '@datalayer/reactor';

// The example's own sources, aliased by `docusaurus.config.js`. There is no
// forked copy of the CMS in this repository.
import App from '@cms-app/App';
import * as UI from '@cms-app/ui';

// The two extensions' browser halves, as *text*. See `moduleLoader` below.
import coreModule from '@cms-extension/core';
import proModule from '@cms-extension/pro';

import {
  installMockHost,
  installedDistributions,
  isInstalled,
  pipInstall,
  pipUninstall,
  subscribe,
} from './backend';

import './cms-theme.css';

installMockHost();

// The floor, plus this host's design system — which is what lets the Pro
// assistant draw a panel with components it never installed.
setReactorSharedModules({
  react: React,
  '@datalayer/reactor': Reactor,
  '@datalayer/reactor/react': ReactorReact,
  '@cms/ui': UI,
});

/** The two modules, by the URL the host says they live at. */
const MODULES: Record<string, string> = {
  '/cms-demo/cms-core.js': coreModule,
  '/cms-demo/cms-pro.js': proModule,
};

/**
 * Fetch a remote module — from a blob rather than the network.
 *
 * The extensions' `index.js` files are the example's, un-built, and they are
 * bundled into this page as source text (see the `cms-extension` rule in
 * `docusaurus.config.js`). Serving them as static files would mean copying them
 * into the site, which is the forked-example problem this repository avoids
 * everywhere else.
 *
 * What stays real is the shape: `defineRemotePlugin` still checks the declared
 * entry against the origin allowlist, still refuses a version it does not
 * speak, and still performs a genuine dynamic `import()` of a URL it did not
 * have at build time.
 */
const moduleLoader = async (url: string) => {
  const source = MODULES[new URL(url, window.location.href).pathname];
  if (!source) {
    throw new Error(`No module at ${url}`);
  }
  const blob = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    return (await import(/* webpackIgnore: true */ blob)) as Record<string, unknown>;
  } finally {
    URL.revokeObjectURL(blob);
  }
};

/** `pip list`, and the two buttons that change it. */
function Environment({ onRefresh }: { onRefresh: () => void }) {
  const installed = useSyncExternalStore(
    subscribe,
    installedDistributions,
    installedDistributions,
  );
  const [stale, setStale] = useState(false);
  const pro = isInstalled('cms-pro');

  useEffect(() => subscribe(() => setStale(true)), []);

  const refresh = () => {
    setStale(false);
    onRefresh();
  };

  return (
    <div className="not-content" style={{ marginBottom: '1rem' }}>
      <div
        style={{
          border: '1px solid var(--ifm-color-emphasis-300)',
          borderRadius: 8,
          padding: '0.75rem 1rem',
          fontSize: '0.85rem',
          display: 'grid',
          gap: '0.6rem',
        }}
      >
        <div>
          <strong>The Python environment</strong> — what `pip list` would show.
        </div>
        <code style={{ fontSize: '0.8rem' }}>{installed.join('  ') || '(nothing)'}</code>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="button button--primary button--sm"
            onClick={() => (pro ? pipUninstall('cms-pro') : pipInstall('cms-pro'))}
          >
            {pro ? 'pip uninstall cms-pro' : 'pip install cms-pro'}
          </button>
          <button
            className="button button--secondary button--sm"
            onClick={refresh}
            disabled={!stale}
          >
            {stale ? '↻ Refresh the browser' : 'Refresh the browser'}
          </button>
        </div>
        {stale ? (
          <div style={{ color: 'var(--ifm-color-warning-darkest)' }}>
            The environment changed. The running application has not noticed —
            it asked the server what was installed when it started. Refresh, as
            you would against a real host.
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CmsApp() {
  const [generation, setGeneration] = useState(0);
  const [remotes, setRemotes] = useState<LazyPluginRef[] | null>(null);

  const bootstrap = useCallback(async () => {
    setRemotes(null);
    // Exactly what the example's `main.tsx` does: ask the server what is
    // installed, and turn the answer into plugins.
    const found = await bootstrapExtensions(window.location.origin, {
      loader: moduleLoader,
    });
    setRemotes(found as LazyPluginRef[]);
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap, generation]);

  return (
    <>
      <Environment onRefresh={() => setGeneration((value) => value + 1)} />
      <div
        className="reactor-cms-demo"
        style={{
          border: '1px solid var(--ifm-color-emphasis-300)',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--color-background)',
          color: 'var(--color-foreground)',
        }}
      >
        {remotes === null ? (
          <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.6 }}>
            Asking the host what is installed…
          </div>
        ) : (
          // Keyed on the generation, so a refresh rebuilds the platform the way
          // reloading the page would.
          <App key={generation} remotes={remotes} />
        )}
      </div>
    </>
  );
}
