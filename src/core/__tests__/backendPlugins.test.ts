/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Activation that follows the other tier.
 *
 * `requiredBackendPlugins` used to gate rendering only, which left a plugin
 * listed as running while the server behind it had gone — and its
 * contributions sitting in a point, backed by nothing. These are the questions
 * that raises, and the third is the one that keeps a server from overruling a
 * person.
 */

import { describe, expect, it } from 'vitest';

import { buildReactorFromPlugins } from '../reactor';
import { contribution, defineContributionPoint } from '../contributions';
import { definePlugin } from '../plugin';

const Views = defineContributionPoint<string>('app.views');

function store() {
  const Catalog = definePlugin({
    name: '@app/catalog',
    requiredBackendPlugins: ['catalog'],
    contributes: [contribution(Views, 'catalog', { id: 'catalog' })],
    build: () => 'catalog',
  });
  const Shop = definePlugin({
    name: '@app/shop',
    dependencies: [Catalog],
    requiredBackendPlugins: ['catalog'],
    build: () => 'shop',
  });
  const Standalone = definePlugin({ name: '@app/shell', build: () => 'shell' });

  const reactor = buildReactorFromPlugins([Catalog, Shop, Standalone]);
  reactor.start();
  return reactor;
}

const activated = (reactor: ReturnType<typeof store>) =>
  reactor.listPlugins().filter((name) => reactor.getManifest(name)?.activated);

describe('setBackendPlugins', () => {
  it('stands a plugin down when what it requires goes away', async () => {
    const reactor = store();
    const change = await reactor.setBackendPlugins([]);

    expect(change.deactivated).toContain('@app/catalog');
    // Dependants go too, and first: the shop needs what the catalog built.
    expect(change.deactivated.indexOf('@app/shop')).toBeLessThan(
      change.deactivated.indexOf('@app/catalog'),
    );
    expect(activated(reactor)).toEqual(['@app/shell']);
    // And its contributions leave with it, rather than sitting in the point
    // backed by a server that is no longer answering.
    expect(reactor.getContributions(Views)).toEqual([]);
  });

  it('brings it back when the backend plugin returns', async () => {
    const reactor = store();
    await reactor.setBackendPlugins([]);
    const change = await reactor.setBackendPlugins(['catalog']);

    // Dependencies first.
    expect(change.activated).toEqual(['@app/catalog', '@app/shop']);
    expect(reactor.getContributions(Views).map((entry) => entry.value)).toEqual([
      'catalog',
    ]);
  });

  it('never revives a plugin a person switched off', async () => {
    const reactor = store();
    reactor.disable('@app/shop');
    await reactor.setBackendPlugins([]);
    await reactor.setBackendPlugins(['catalog']);

    // The catalog is back because the server came back. The shop is not,
    // because somebody switched it off — and no event outranks that.
    expect(reactor.getManifest('@app/catalog')?.activated).toBe(true);
    expect(reactor.isEnabled('@app/shop')).toBe(false);
    expect(reactor.getManifest('@app/shop')?.activated).toBe(false);
  });

  it('leaves alone a plugin stood down for some other reason', async () => {
    const reactor = store();
    reactor.deactivate('@app/shell');
    await reactor.setBackendPlugins(['catalog']);

    // It did not go down with a backend plugin, so a backend plugin returning
    // is not a reason to bring it back.
    expect(reactor.getManifest('@app/shell')?.activated).toBe(false);
  });

  it('an unchanged list changes nothing', async () => {
    const reactor = store();
    await reactor.setBackendPlugins(['catalog']);
    const change = await reactor.setBackendPlugins(['catalog']);
    expect(change).toEqual({ deactivated: [], activated: [] });
  });
});
