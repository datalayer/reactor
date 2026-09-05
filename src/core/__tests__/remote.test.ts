/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Remote plugins: a lazy plugin whose module comes from a URL.
 *
 * The questions worth asking are the ones a bundled import never raises — is
 * it listed before it loads, is a refusal survivable, does a broken remote cost
 * one plugin or the platform — so those are what these test.
 */

import { describe, expect, it, vi } from 'vitest';

import { buildReactorFromPlugins } from '../reactor';
import { definePlugin } from '../plugin';
import { onView } from '../activation';
import {
  REACTOR_SHARED_MODULES,
  bootstrapExtensions,
  defineRemotePlugin,
  getReactorSharedModules,
  missingSharedModules,
  setReactorSharedModules,
  type RemoteModuleLoader,
} from '../remote';

const PANEL = definePlugin({
  name: '@hello/panel',
  build: () => ({ greeting: 'hello' }),
});

/** A loader standing in for the network, so a test never touches one. */
const loaderFor = (module: Record<string, unknown>): RemoteModuleLoader =>
  vi.fn(async () => module);

describe('defineRemotePlugin', () => {
  it('is listed and described before its module is fetched', async () => {
    const load = loaderFor({ default: PANEL });
    const remote = defineRemotePlugin(
      {
        name: '@hello/panel',
        displayName: 'Hello panel',
        description: 'Arrived with a pip install.',
        emoji: '👋',
        entry: '/reactor-extensions/hello/index.js',
        activationEvents: [onView('hello')],
      },
      { loader: load },
    );

    const reactor = buildReactorFromPlugins([remote]);
    reactor.start();

    // The manifest is complete while the module has not been asked for. This
    // is the whole reason the manifest is declared on the reference.
    const manifest = reactor.getManifest('@hello/panel');
    expect(manifest?.displayName).toBe('Hello panel');
    expect(manifest?.emoji).toBe('👋');
    expect(manifest?.lazy).toBe(true);
    expect(manifest?.loaded).toBe(false);
    expect(load).not.toHaveBeenCalled();

    await reactor.fire(onView('hello'));

    expect(load).toHaveBeenCalledWith('/reactor-extensions/hello/index.js', expect.objectContaining({ name: expect.any(String) }));
    expect(reactor.getManifest('@hello/panel')?.loaded).toBe(true);
    expect(reactor.getOutput('@hello/panel')).toEqual({ greeting: 'hello' });
  });

  it('takes a named export when the manifest asked for one', async () => {
    const remote = defineRemotePlugin(
      { name: '@hello/panel', entry: 'https://x/index.js', export: 'HelloPlugin' },
      { loader: loaderFor({ HelloPlugin: PANEL }), allowedOrigins: ['https://x'] },
    );
    const reactor = buildReactorFromPlugins([remote]);
    reactor.start();
    await reactor.whenReady();
    expect(reactor.getOutput('@hello/panel')).toEqual({ greeting: 'hello' });
  });

  it('says why a module never arrived, rather than only that it did not', async () => {
    const reactor = buildReactorFromPlugins([
      defineRemotePlugin(
        { name: '@hello/panel', entry: 'https://elsewhere.example/index.js' },
        { loader: loaderFor({ default: PANEL }) },
      ),
    ]);
    reactor.start();
    await reactor.whenReady();

    // Listed, unloadable, and explained. "Not here" on its own asks a reader
    // to guess between a slow network, a refused origin and a module that
    // threw — three different things to do about it.
    const manifest = reactor.getManifest('@hello/panel');
    expect(manifest?.loaded).toBe(false);
    expect(manifest?.loadError).toMatch(/not an allowed origin/);
  });

  it('refuses an API version it does not speak, and survives it', async () => {
    const Bundled = definePlugin({ name: '@app/shell', build: () => 'up' });
    const remote = defineRemotePlugin(
      { name: '@hello/panel', entry: '/index.js', apiVersion: 'v99' },
      { loader: loaderFor({ default: PANEL }) },
    );

    const reactor = buildReactorFromPlugins([Bundled, remote]);
    reactor.start();
    await reactor.whenReady();

    // One plugin is missing; nothing else is.
    expect(reactor.getOutput('@app/shell')).toBe('up');
    expect(reactor.getManifest('@hello/panel')?.loaded).toBe(false);
  });

  it('refuses a protocol-relative URL, which is cross-origin in a browser', async () => {
    // `//evil.example/x.js` has no scheme, so "does it look absolute?" says
    // local — and the browser loads it from evil.example anyway. The check has
    // to resolve the URL rather than pattern-match it.
    const original = (globalThis as Record<string, unknown>).location;
    (globalThis as Record<string, unknown>).location = {
      href: 'https://app.example/page',
      origin: 'https://app.example',
    };
    try {
      const reactor = buildReactorFromPlugins([
        defineRemotePlugin(
          { name: '@hello/panel', entry: '//evil.example/x.js' },
          { loader: loaderFor({ default: PANEL }) },
        ),
      ]);
      reactor.start();
      await reactor.whenReady();

      expect(reactor.getManifest('@hello/panel')?.loaded).toBe(false);
      expect(reactor.getManifest('@hello/panel')?.loadError).toMatch(/evil\.example/);
    } finally {
      (globalThis as Record<string, unknown>).location = original;
    }
  });

  it('allows a same-origin absolute URL when there is a page to compare with', async () => {
    const original = (globalThis as Record<string, unknown>).location;
    (globalThis as Record<string, unknown>).location = {
      href: 'https://app.example/page',
      origin: 'https://app.example',
    };
    try {
      const reactor = buildReactorFromPlugins([
        defineRemotePlugin(
          { name: '@hello/panel', entry: 'https://app.example/remotes/x.js' },
          { loader: loaderFor({ default: PANEL }) },
        ),
      ]);
      reactor.start();
      await reactor.whenReady();
      expect(reactor.getManifest('@hello/panel')?.loaded).toBe(true);
    } finally {
      (globalThis as Record<string, unknown>).location = original;
    }
  });

  it('refuses a cross-origin remote unless the origin was named', async () => {
    const reactor = buildReactorFromPlugins([
      defineRemotePlugin(
        { name: '@hello/panel', entry: 'https://elsewhere.example/index.js' },
        { loader: loaderFor({ default: PANEL }) },
      ),
    ]);
    reactor.start();
    await reactor.whenReady();
    expect(reactor.getManifest('@hello/panel')?.loaded).toBe(false);
  });

  it('a module that exports nothing usable is a failure, not a crash', async () => {
    const reactor = buildReactorFromPlugins([
      defineRemotePlugin(
        { name: '@hello/panel', entry: '/index.js', export: 'Missing' },
        { loader: loaderFor({ default: PANEL }) },
      ),
    ]);
    reactor.start();
    await expect(reactor.whenReady()).resolves.toBeUndefined();
    expect(reactor.getManifest('@hello/panel')?.loaded).toBe(false);
  });
});

describe('shared modules', () => {
  it('accumulates rather than replacing, so two callers can both publish', () => {
    setReactorSharedModules({ react: 'REACT' });
    setReactorSharedModules({ '@datalayer/reactor': 'RUNTIME' });
    expect(getReactorSharedModules()).toMatchObject({
      react: 'REACT',
      '@datalayer/reactor': 'RUNTIME',
    });
  });
});

describe('bootstrapExtensions', () => {
  const answer = [
    {
      name: 'hello',
      apiVersion: 'v1',
      entry: '/reactor-extensions/hello/index.js',
      plugins: [
        { name: '@hello/panel', displayName: 'Hello panel', requiredBackendPlugins: ['hello'] },
      ],
    },
  ];

  it('keeps the extension that delivered each plugin', async () => {
    const remotes = await bootstrapExtensions('http://localhost:8799', {
      fetchJson: async () => [
        {
          name: 'Pro',
          displayName: 'Pro',
          emoji: '⭐',
          entry: '/reactor-extensions/Pro/index.js',
          plugins: [{ name: '@pro/one' }, { name: '@pro/two' }],
        },
      ],
      loader: loaderFor({ default: PANEL }),
    });

    const reactor = buildReactorFromPlugins(remotes);
    reactor.start();

    // The server knew these arrived in one distribution. Flattening them here
    // would lose the only thing that answers "what would I uninstall to lose
    // this?" — and it is the hierarchy the whole model rests on.
    expect(reactor.listExtensions()).toEqual(['Pro']);
    expect(reactor.getManifest('@pro/one')?.extension).toBe('Pro');
    expect(reactor.getExtensionManifest('Pro')?.emoji).toBe('⭐');
    // Grouping is delivery, not governance: each is still switched on its own.
    reactor.disable('@pro/one');
    expect(reactor.isEnabled('@pro/two')).toBe(true);
  });

  it('turns the server’s answer into plugins, resolved against the backend', async () => {
    const load = loaderFor({ default: PANEL });
    const remotes = await bootstrapExtensions('http://localhost:8799', {
      fetchJson: async (url) => {
        expect(url).toBe('http://localhost:8799/plugins/frontend-extensions');
        return answer;
      },
      loader: load,
      allowedOrigins: ['http://localhost:8799'],
    });

    const reactor = buildReactorFromPlugins(remotes);
    reactor.start();

    // Described before it loads, from what the server said — not from the
    // module, which has not been fetched.
    expect(reactor.getManifest('@hello/panel')?.displayName).toBe('Hello panel');
    expect(reactor.getRequiredBackendPlugins('@hello/panel')).toEqual(['hello']);

    await reactor.whenReady();
    // A relative entry is resolved against the server that listed it.
    expect(load).toHaveBeenCalledWith(
      'http://localhost:8799/reactor-extensions/hello/index.js',
      expect.objectContaining({ name: expect.any(String) }),
    );
  });

  it('normalises a trailing slash rather than building a double one', async () => {
    let asked = '';
    const load = loaderFor({ default: PANEL });
    const remotes = await bootstrapExtensions('http://localhost:8799/', {
      fetchJson: async (url) => {
        asked = url;
        return answer;
      },
      loader: load,
      allowedOrigins: ['http://localhost:8799'],
    });

    expect(asked).toBe('http://localhost:8799/plugins/frontend-extensions');
    const reactor = buildReactorFromPlugins(remotes);
    reactor.start();
    await reactor.whenReady();
    expect(load).toHaveBeenCalledWith(
      'http://localhost:8799/reactor-extensions/hello/index.js',
      expect.objectContaining({ name: expect.any(String) }),
    );
  });

  it('an unreachable backend costs the extensions, not the shell', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const remotes = await bootstrapExtensions('http://localhost:8799', {
      fetchJson: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(remotes).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('the shared-module floor', () => {
  it('warns by name when a host published nothing a remote will want', async () => {
    // A fresh global: the point is a host that forgot, not one that half-did.
    (globalThis as Record<string, unknown>).__DATALAYER_REACTOR__ = { shared: {} };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const reactor = buildReactorFromPlugins([
      defineRemotePlugin(
        { name: '@hello/panel', entry: '/index.js' },
        { loader: loaderFor({ default: PANEL }) },
      ),
    ]);
    reactor.start();
    await reactor.whenReady();

    // Named, so the fix is obvious. A broken-hooks exception three renders
    // later names none of this.
    const message = warn.mock.calls[0]?.[0] as string;
    expect(message).toContain('react');
    expect(message).toContain('@datalayer/reactor');
    // A warning, not a refusal: a remote that uses no React needs none of it,
    // and the runtime cannot know which this is.
    expect(reactor.getManifest('@hello/panel')?.loaded).toBe(true);
    warn.mockRestore();
  });

  it('reports nothing missing once the host has published the floor', () => {
    setReactorSharedModules(
      Object.fromEntries(REACTOR_SHARED_MODULES.map((name) => [name, {}])),
    );
    expect(missingSharedModules()).toEqual([]);
    // The floor is extensible: a host's design system is its own to add.
    expect(missingSharedModules([...REACTOR_SHARED_MODULES, '@primer/react'])).toEqual([
      '@primer/react',
    ]);
  });
});
