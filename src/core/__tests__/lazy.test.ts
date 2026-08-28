/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildReactorFromExtensions,
  defineExtension,
  defineLazyExtension,
  type ReactorExtension,
} from '../../index';

/** What the platform itself accepts: output types vary per extension. */
type AnyExtension = ReactorExtension<any, any, any>;

/** A promise plus the handle to settle it, so a test can hold a load open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const Base = defineExtension({
  name: '@test/base',
  displayName: 'Base',
  build: () => ({ value: 'base' }),
});

describe('lazy extensions', () => {
  it('starts without waiting for the module, and activates it after', async () => {
    const gate = deferred<{ default: AnyExtension }>();
    const Lazy = defineLazyExtension({
      name: '@test/lazy',
      dependencies: [Base],
      load: () => gate.promise,
    });
    const reactor = buildReactorFromExtensions([Lazy]);

    reactor.start();

    // The eager half is live the moment `start` returns — the whole point.
    expect(reactor.getOutput('@test/base')).toEqual({ value: 'base' });
    expect(reactor.getMetadata('@test/lazy')?.loaded).toBe(false);
    expect(reactor.getOutput('@test/lazy')).toBeUndefined();

    gate.resolve({
      default: defineExtension({
        name: '@test/lazy',
        build: () => ({ value: 'lazy' }),
      }),
    });
    await reactor.whenReady();

    expect(reactor.getMetadata('@test/lazy')?.loaded).toBe(true);
    expect(reactor.getOutput('@test/lazy')).toEqual({ value: 'lazy' });
  });

  it('describes a lazy extension before its module arrives', async () => {
    const Lazy = defineLazyExtension({
      name: '@test/lazy',
      displayName: 'Lazy',
      description: 'Loads late.',
      octicon: 'package',
      emoji: '📦',
      requiredBackendPlugins: ['api'],
      optionalBackendPlugins: ['search'],
      load: () => Promise.resolve(defineExtension({ name: '@test/lazy' })),
    });
    const reactor = buildReactorFromExtensions([Lazy]);

    // Before `start`, so before anything could have been fetched.
    expect(reactor.getMetadata('@test/lazy')).toMatchObject({
      displayName: 'Lazy',
      description: 'Loads late.',
      octicon: 'package',
      emoji: '📦',
      requiredBackendPlugins: ['api'],
      optionalBackendPlugins: ['search'],
      lazy: true,
      loaded: false,
    });

    reactor.start();
    await reactor.whenReady();
    expect(reactor.getMetadata('@test/lazy')?.loaded).toBe(true);
  });

  it('accepts a module namespace or the extension itself', async () => {
    const reactor = buildReactorFromExtensions([
      defineLazyExtension({
        name: '@test/bare',
        load: async () => defineExtension({ name: '@test/bare', build: () => 'bare' }),
      }),
    ]);
    reactor.start();
    await reactor.whenReady();
    expect(reactor.getOutput('@test/bare')).toBe('bare');
  });

  it('activates in dependency order however the modules land', async () => {
    const activated: string[] = [];
    const first = deferred<AnyExtension>();
    const second = deferred<AnyExtension>();

    const First = defineLazyExtension({ name: '@test/first', load: () => first.promise });
    const Second = defineLazyExtension({
      name: '@test/second',
      dependencies: [First],
      load: () => second.promise,
    });
    const reactor = buildReactorFromExtensions([Second]);
    reactor.start();

    // The dependant's module arrives first; it must still activate second.
    second.resolve(
      defineExtension({ name: '@test/second', build: () => activated.push('second') }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(activated).toEqual([]);

    first.resolve(
      defineExtension({ name: '@test/first', build: () => activated.push('first') }),
    );
    await reactor.whenReady();

    expect(activated).toEqual(['first', 'second']);
  });

  it('survives a module that fails to load', async () => {
    const reactor = buildReactorFromExtensions([
      Base,
      defineLazyExtension({
        name: '@test/broken',
        load: () => Promise.reject(new Error('offline')),
      }),
    ]);

    reactor.start();
    await expect(reactor.whenReady()).resolves.toBeUndefined();

    // One plugin missing, not a dead platform.
    expect(reactor.getMetadata('@test/broken')?.loaded).toBe(false);
    expect(reactor.getOutput('@test/base')).toEqual({ value: 'base' });
  });

  it('does not activate a lazy extension that was disabled while loading', async () => {
    const build = vi.fn(() => 'built');
    const gate = deferred<AnyExtension>();
    const reactor = buildReactorFromExtensions([
      defineLazyExtension({ name: '@test/lazy', load: () => gate.promise }),
    ]);
    reactor.start();

    reactor.disable('@test/lazy');
    gate.resolve(defineExtension({ name: '@test/lazy', build }));
    await reactor.whenReady();

    expect(build).not.toHaveBeenCalled();

    // Enabling afterwards runs it, now that the module is here.
    reactor.enable('@test/lazy');
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('activates once when start/stop/start overlap a load', async () => {
    // React's StrictMode does exactly this: mount, unmount, mount. Both passes
    // are in flight over the same module, and only one may activate it.
    const load = vi.fn(() => gateFor.promise);
    const gateFor = deferred<AnyExtension>();
    const contributed = vi.fn();
    const reactor = buildReactorFromExtensions([
      defineLazyExtension({ name: '@test/lazy', load }),
    ]);

    reactor.start();
    reactor.stop();
    reactor.start();

    gateFor.resolve(defineExtension({ name: '@test/lazy', build: contributed }));
    await reactor.whenReady();

    // One fetch, and one activation — not one per `start`.
    expect(load).toHaveBeenCalledTimes(1);
    expect(contributed).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers when a module lands', async () => {
    const gate = deferred<AnyExtension>();
    const reactor = buildReactorFromExtensions([
      defineLazyExtension({ name: '@test/lazy', load: () => gate.promise }),
    ]);
    reactor.start();

    const seen = vi.fn();
    reactor.subscribe(seen);
    gate.resolve(defineExtension({ name: '@test/lazy', build: () => 'x' }));
    await reactor.whenReady();

    // Without this the UI would never learn the plugin had arrived.
    expect(seen).toHaveBeenCalled();
  });
});

describe('extension metadata', () => {
  it('falls back to the identifier when no display name is given', () => {
    const reactor = buildReactorFromExtensions([defineExtension({ name: '@test/plain' })]);
    expect(reactor.getMetadata('@test/plain')).toMatchObject({
      name: '@test/plain',
      displayName: '@test/plain',
      lazy: false,
      loaded: true,
    });
  });

  it('reports required and optional backend plugins apart', () => {
    const reactor = buildReactorFromExtensions([
      defineExtension({
        name: '@test/api',
        requiredBackendPlugins: ['catalog'],
        optionalBackendPlugins: ['search'],
      }),
    ]);
    expect(reactor.getRequiredBackendPlugins('@test/api')).toEqual(['catalog']);
    expect(reactor.getOptionalBackendPlugins('@test/api')).toEqual(['search']);
  });

  it('has nothing to say about an extension it does not have', () => {
    const reactor = buildReactorFromExtensions([]);
    expect(reactor.getMetadata('@test/absent')).toBeUndefined();
  });
});
