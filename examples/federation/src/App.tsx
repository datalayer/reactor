/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Plugins that arrive from a URL.
 *
 * Three things this example exists to show, and nothing else:
 *
 * 1. **A remote is listed before it is fetched.** Its manifest is declared on
 *    the reference, so the plugin list is complete on the first frame while the
 *    modules are still on the wire.
 * 2. **A bad remote costs one plugin.** `@remote/broken` throws while its
 *    module evaluates — the worst case, because the request succeeded. The rest
 *    of the platform is unaffected and the list says which one failed.
 * 3. **A plugin can arrive that nothing named.** Paste a URL, and
 *    `reactor.install` puts it into the running platform. No rebuild, and
 *    nothing already running is restarted. That is a marketplace install with
 *    the marketplace removed.
 */

import React, { useCallback, useState, useSyncExternalStore } from 'react';
import {
  buildReactorFromPlugins,
  defineRemotePlugin,
  definePlugin,
} from '@datalayer/reactor';
import {
  ReactorSlot,
  useReactor,
  useReactorPlatform,
} from '@datalayer/reactor/react';

/** Bundled with the shell, so there is something to compare a remote against. */
const ShellPlugin = definePlugin({
  name: '@app/shell',
  displayName: 'Shell',
  description: 'Bundled with the application, like every plugin used to be.',
  build: () => ({ components: [] }),
});

/**
 * Two remotes, declared with everything a host needs before their code exists.
 *
 * `entry` is a URL rather than an import, and that is the whole difference —
 * `defineRemotePlugin` returns a lazy plugin, so ordering, activation events,
 * failure isolation and the switches all work exactly as they already did.
 */
const GreetingRemote = defineRemotePlugin({
  name: '@remote/greeting',
  displayName: 'Greeting',
  description: 'A working remote, served from /remotes/greeting.js.',
  entry: '/remotes/greeting.js',
});

const BrokenRemote = defineRemotePlugin({
  name: '@remote/broken',
  displayName: 'Broken',
  description: 'Throws while loading, on purpose. Watch what it costs.',
  entry: '/remotes/broken.js',
});

const reactor = buildReactorFromPlugins([ShellPlugin, GreetingRemote, BrokenRemote]);

/** Re-render whenever the platform changes: installs, loads, failures. */
function usePlatformRevision() {
  const platform = useReactorPlatform();
  useSyncExternalStore(platform.subscribe, platform.getRevision, platform.getRevision);
  return platform;
}

function PluginList() {
  const platform = usePlatformRevision();

  return (
    <div className="card">
      <strong>Plugins</strong>
      <p className="lede">
        Every row is here from the first frame. The ones marked <em>on the wire</em>{' '}
        have a manifest and no code yet.
      </p>
      {platform.listPlugins().map((name) => {
        const manifest = platform.getManifest(name);
        // Four states, and the fourth is the one worth having: a plugin whose
        // module never arrived is listed, and says why. "Not here" on its own
        // asks the reader to guess between a slow network, a refused origin
        // and a module that threw.
        const state = !manifest?.lazy
          ? 'bundled'
          : manifest.loadError
            ? 'failed'
            : manifest.loaded
              ? 'loaded'
              : 'on the wire';
        return (
          <div className="row" key={name}>
            <span>
              <strong>{manifest?.displayName ?? name}</strong>
              <br />
              <code>{name}</code>
              {manifest?.description ? <> — {manifest.description}</> : null}
              {manifest?.loadError ? (
                <>
                  <br />
                  <span className="error">{manifest.loadError}</span>
                </>
              ) : null}
            </span>
            <span
              className={`state${state === 'failed' ? ' failed' : ''}${
                state === 'on the wire' ? ' waiting' : ''
              }`}
            >
              {state}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Paste a URL; get a plugin. */
function InstallBox() {
  const platform = usePlatformRevision();
  const [url, setUrl] = useState('/remotes/late.js');
  const [name, setName] = useState('@remote/late');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const install = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // The manifest is what the *installer* knows. In a real marketplace it
      // comes from the listing; here, from two text boxes.
      await platform.install(
        defineRemotePlugin({
          name,
          displayName: name,
          description: `Installed at runtime from ${url}`,
          entry: url,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [platform, name, url]);

  return (
    <div className="card">
      <strong>Install one now</strong>
      <p className="lede">
        Nothing in this application names <code>/remotes/late.js</code>. Install it
        and it joins the platform that is already running — nothing restarts.
      </p>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Plugin name"
        />
        <input
          type="text"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-label="Module URL"
        />
        <button onClick={() => void install()} disabled={busy}>
          {busy ? 'Installing…' : 'Install'}
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}
      <p className="lede" style={{ marginBottom: 0 }}>
        Try an absolute URL on another origin: it is refused, because a remote
        runs with this page’s privileges and “anywhere” is not a default anybody
        should get by accident.
      </p>
    </div>
  );
}

export default function App() {
  useReactor(reactor);

  return (
    <>
      <h1>⚛️ Reactor — plugins from a URL</h1>
      <p className="lede">
        One plugin is bundled with this page. The others arrive over HTTP, and one
        of them was not known to anybody when this page was built.
      </p>
      <PluginList />
      <InstallBox />
      {/* Whatever the remotes contribute. The shell offers a place and does not
          know, or need to know, who fills it. */}
      <ReactorSlot slot="main" />
    </>
  );
}
