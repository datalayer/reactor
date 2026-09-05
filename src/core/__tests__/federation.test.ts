/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Remotes delivered as Module Federation containers.
 *
 * The runtime SDK is replaced by a recording fake: what these test is the
 * contract Reactor keeps with it — that the host is initialised once with what
 * `setReactorSharedModules` published, that a container is registered before
 * it is read, that a plugin is still one lazy plugin in the platform, and that
 * an update re-registers by name rather than starting a second host.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildReactorFromPlugins } from '../reactor';
import { definePlugin } from '../plugin';
import { onView } from '../activation';
import { bootstrapExtensions, setReactorSharedModules } from '../remote';
import {
  defineFederatedPlugin,
  initReactorFederation,
  resetReactorFederation,
  setFederationRuntime,
  sharedFromHost,
  updateFederatedRemote,
  type FederationRuntime,
} from '../federation';

const CHARTS = definePlugin({
  name: '@acme/charts',
  build: () => ({ draws: 'charts' }),
});

/** A runtime that records every call and answers `loadRemote` from a table. */
function fakeRuntime(modules: Record<string, unknown> = {}) {
  const calls = { init: [] as unknown[], register: [] as unknown[], preload: [] as unknown[] };
  const runtime: FederationRuntime = {
    init: vi.fn((options) => calls.init.push(options)),
    registerRemotes: vi.fn((remotes, options) => calls.register.push({ remotes, options })),
    preloadRemote: vi.fn(async (options) => calls.preload.push(options)),
    loadRemote: vi.fn(async (id: string) => (modules[id] ?? null) as never),
  };
  return { runtime, calls };
}

afterEach(() => {
  resetReactorFederation();
  setFederationRuntime(undefined);
});

describe('sharedFromHost', () => {
  it('turns what the host published into singletons', () => {
    const React = { createElement: () => null };
    setReactorSharedModules({ react: React });
    const shared = sharedFromHost({ react: '19.2.8' });
    expect(shared.react.lib()).toBe(React);
    expect(shared.react.version).toBe('19.2.8');
    expect(shared.react.shareConfig).toMatchObject({ singleton: true, requiredVersion: false });
  });

  it('lets a host tighten one module without restating the rest', () => {
    setReactorSharedModules({ react: {}, zustand: {} });
    const shared = sharedFromHost({}, { zustand: { shareConfig: { singleton: false } } });
    expect(shared.zustand.shareConfig?.singleton).toBe(false);
    expect(shared.react.shareConfig?.singleton).toBe(true);
  });
});

describe('initReactorFederation', () => {
  it('stands the host up once, with the published modules', async () => {
    const { runtime, calls } = fakeRuntime();
    setFederationRuntime(runtime);
    setReactorSharedModules({ react: { r: 1 } });

    const first = await initReactorFederation({ name: 'shell' });
    const second = await initReactorFederation({ name: 'another' });

    expect(second).toBe(first);
    expect(calls.init).toHaveLength(1);
    expect(calls.init[0]).toMatchObject({ name: 'shell' });
    expect((calls.init[0] as { shared: Record<string, unknown> }).shared).toHaveProperty('react');
  });
});

describe('defineFederatedPlugin', () => {
  it('registers the container, reads the module, and is one lazy plugin', async () => {
    const { runtime, calls } = fakeRuntime({ 'acme_charts/plugin': { default: CHARTS } });
    setFederationRuntime(runtime);

    const remote = defineFederatedPlugin({
      name: '@acme/charts',
      displayName: 'Charts',
      entry: 'https://cdn.example/charts/remoteEntry.js',
      scope: 'acme_charts',
      activationEvents: [onView('charts')],
    }, { allowedOrigins: ['https://cdn.example'] });

    const reactor = buildReactorFromPlugins([remote]);
    reactor.start();
    await reactor.whenReady();
    // Listed and described before anything was fetched.
    expect(reactor.getManifest('@acme/charts')?.displayName).toBe('Charts');
    expect(reactor.getManifest('@acme/charts')?.loaded).toBe(false);
    expect(runtime.loadRemote).not.toHaveBeenCalled();

    await reactor.fire(onView('charts'));

    expect(calls.register[0]).toMatchObject({
      remotes: [{ name: 'acme_charts', entry: 'https://cdn.example/charts/remoteEntry.js' }],
    });
    expect(runtime.loadRemote).toHaveBeenCalledWith('acme_charts/plugin');
    expect(reactor.getOutput('@acme/charts')).toEqual({ draws: 'charts' });
  });

  it('asks for the exposed module it was told about', async () => {
    const { runtime } = fakeRuntime({ 'acme_charts/bar-chart': { default: CHARTS } });
    setFederationRuntime(runtime);
    const remote = defineFederatedPlugin({
      name: '@acme/charts',
      entry: '/remotes/charts/remoteEntry.js',
      scope: 'acme_charts',
      module: './bar-chart',
    });
    const reactor = buildReactorFromPlugins([remote]);
    reactor.start();
    await reactor.whenReady();
    expect(runtime.loadRemote).toHaveBeenCalledWith('acme_charts/bar-chart');
  });

  it('costs one plugin when the container exposes no such module', async () => {
    const { runtime } = fakeRuntime({});
    setFederationRuntime(runtime);
    const good = definePlugin({ name: '@local/ok', build: () => ({ ok: true }) });
    const remote = defineFederatedPlugin({
      name: '@acme/missing',
      entry: '/remotes/x/remoteEntry.js',
      scope: 'acme_x',
    });
    const reactor = buildReactorFromPlugins([good, remote]);
    reactor.start();
    await reactor.whenReady();
    expect(reactor.getManifest('@acme/missing')?.loaded).toBe(false);
    expect(reactor.getManifest('@acme/missing')?.loadError).toMatch(/exposes no acme_x\/plugin/);
    expect(reactor.getOutput('@local/ok')).toEqual({ ok: true });
  });
});

describe('updateFederatedRemote', () => {
  it('re-registers the same name with new code and pulls it in', async () => {
    const { runtime, calls } = fakeRuntime();
    setFederationRuntime(runtime);
    await initReactorFederation();

    await updateFederatedRemote('acme_charts', '/remotes/charts/remoteEntry.js');

    const last = calls.register.at(-1) as { remotes: Array<{ name: string; entry: string }>; options: { force: boolean } };
    expect(last.options.force).toBe(true);
    expect(last.remotes[0].name).toBe('acme_charts');
    // Cache-busted: remoteEntry.js is the most cacheable filename there is.
    expect(last.remotes[0].entry).toMatch(/remoteEntry\.js\?t=\d+$/);
    expect(calls.preload[0]).toEqual([{ nameOrAlias: 'acme_charts' }]);
  });
});

describe('bootstrapExtensions with a container', () => {
  it('loads a packaged extension whose kind is federated through the container loader', async () => {
    const { runtime } = fakeRuntime({ 'hello_container/plugin': { default: CHARTS } });
    setFederationRuntime(runtime);
    const extensions = await bootstrapExtensions('http://localhost:8799', {
      fetchJson: async () => [
        {
          name: 'hello-extension',
          kind: 'federated',
          remoteName: 'hello_container',
          module: './plugin',
          entry: '/reactor-extensions/hello-extension/remoteEntry.js',
          plugins: [{ name: '@hello/charts' }],
        },
      ],
      allowedOrigins: ['http://localhost:8799'],
    });
    const reactor = buildReactorFromPlugins(extensions);
    reactor.start();
    await reactor.whenReady();
    expect(runtime.loadRemote).toHaveBeenCalledWith('hello_container/plugin');
    expect(reactor.getOutput('@hello/charts')).toEqual({ draws: 'charts' });
  });
});
