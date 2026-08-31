/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Installing a plugin into a platform that is already running.
 *
 * `buildReactorFromPlugins` takes the set an application was built with. This
 * is the set it did not know about — a remote from a URL somebody typed in, an
 * extension the server reported after a `pip install`. Without it, "install a
 * plugin" means rebuilding the platform, which restarts everything in it.
 */

import { describe, expect, it, vi } from 'vitest';

import { buildReactorFromPlugins } from '../reactor';
import { contribution, defineContributionPoint } from '../contributions';
import { defineExtension } from '../extension';
import { defineLazyPlugin, definePlugin } from '../plugin';
import { onView } from '../activation';

const Items = defineContributionPoint<string>('app.items');

const Shell = definePlugin({ name: '@app/shell', build: () => 'shell' });

describe('install', () => {
  it('adds a plugin to a running platform without restarting it', async () => {
    const reactor = buildReactorFromPlugins([Shell]);
    reactor.start();
    const outputBefore = reactor.getOutput('@app/shell');

    const installed = await reactor.install(
      definePlugin({
        name: '@app/late',
        build: () => 'late',
        contributes: [contribution(Items, 'from-late', { id: 'late' })],
      }),
    );

    expect(installed).toEqual(['@app/late']);
    expect(reactor.getContributions(Items).map((one) => one.value)).toEqual([
      'from-late',
    ]);
    // The point of not rebuilding: what was already running is untouched, and
    // anything holding its output still holds the same object.
    expect(reactor.getOutput('@app/shell')).toBe(outputBefore);
  });

  it('orders a new plugin against the ones already there', async () => {
    const reactor = buildReactorFromPlugins([Shell]);
    reactor.start();

    const Base = definePlugin({ name: '@app/base', build: () => 'base' });
    const Top = definePlugin({
      name: '@app/top',
      dependencies: [Base],
      build: (ctx) => `top-on-${ctx.reactor.getOutput('@app/base')}`,
    });

    // Handed over in the wrong order on purpose: a marketplace hands over a
    // package, not a topological sort.
    await reactor.install(defineExtension({ name: '@app/pair', plugins: [Top, Base] }));

    expect(reactor.getOutput('@app/top')).toBe('top-on-base');
    expect(reactor.listPlugins().indexOf('@app/base')).toBeLessThan(
      reactor.listPlugins().indexOf('@app/top'),
    );
    // Grouping survives the trip: the extension delivered them.
    expect(reactor.getManifest('@app/top')?.extension).toBe('@app/pair');
  });

  it('installs a lazy plugin without fetching it, until its event fires', async () => {
    const load = vi.fn(async () => definePlugin({ name: '@app/heavy', build: () => 'heavy' }));
    const reactor = buildReactorFromPlugins([Shell]);
    reactor.start();

    await reactor.install(
      defineLazyPlugin({
        name: '@app/heavy',
        displayName: 'Heavy',
        activationEvents: [onView('heavy')],
        load,
      }),
    );

    // Listed and describable straight away; the module has not been asked for.
    expect(reactor.getManifest('@app/heavy')?.displayName).toBe('Heavy');
    expect(load).not.toHaveBeenCalled();

    await reactor.fire(onView('heavy'));
    expect(reactor.getOutput('@app/heavy')).toBe('heavy');
  });

  it('installing the same plugin twice is a no-op, not an error', async () => {
    const reactor = buildReactorFromPlugins([Shell]);
    reactor.start();
    const Late = definePlugin({ name: '@app/late', build: () => 'late' });

    expect(await reactor.install(Late)).toEqual(['@app/late']);
    // What a retry looks like.
    expect(await reactor.install(Late)).toEqual([]);
  });

  it('refuses a plugin that conflicts with one already installed', async () => {
    const reactor = buildReactorFromPlugins([Shell]);
    reactor.start();
    await expect(
      reactor.install(
        definePlugin({ name: '@app/rival', conflictsWith: ['@app/shell'] }),
      ),
    ).rejects.toThrow(/conflicts with @app\/shell/);
  });

  it('before start, an installed plugin goes up with everything else', async () => {
    const reactor = buildReactorFromPlugins([Shell]);
    await reactor.install(definePlugin({ name: '@app/early', build: () => 'early' }));

    // Not running yet — installing is not starting.
    expect(reactor.getManifest('@app/early')?.activated).toBe(false);

    reactor.start();
    expect(reactor.getOutput('@app/early')).toBe('early');
  });
});
