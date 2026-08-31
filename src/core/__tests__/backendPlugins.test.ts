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

  it('does not revive something another cause stood down', async () => {
    // The invariant the revive list exists to keep. A plugin taken down by the
    // backend comes back with the backend; one taken down for any other reason
    // is not the backend's to bring back, and doing so would silently undo a
    // deactivation the server knew nothing about.
    const reactor = store();
    await reactor.setBackendPlugins([]);
    expect(reactor.getManifest('@app/shop')?.activated).toBe(false);

    // While it is down for the backend, somebody stands it down for good.
    // `@app/shop` rather than `@app/catalog`, because nothing depends on the
    // shop — a *dependency* would legitimately come back with its dependant,
    // and that is a different question from this one.
    reactor.deactivate('@app/shop');

    const change = await reactor.setBackendPlugins(['catalog']);
    expect(change.activated).not.toContain('@app/shop');
    expect(reactor.getManifest('@app/shop')?.activated).toBe(false);
    // The catalog, which nobody claimed, does come back.
    expect(reactor.getManifest('@app/catalog')?.activated).toBe(true);
  });

  it('brings a dependency back with the dependant that needs it', async () => {
    // The other side of the rule above: reviving `@app/shop` cannot leave the
    // catalog it depends on switched off, whatever the revive list says.
    const reactor = store();
    await reactor.setBackendPlugins([]);
    await reactor.setBackendPlugins(['catalog']);

    expect(reactor.getManifest('@app/catalog')?.activated).toBe(true);
    expect(reactor.getManifest('@app/shop')?.activated).toBe(true);
  });

  it('drops its claim on a plugin that came back another way', async () => {
    const reactor = store();
    await reactor.setBackendPlugins([]);

    // It comes up again through an ordinary activation path.
    await reactor.fire('*');
    expect(reactor.getManifest('@app/shell')?.activated).toBe(true);

    // The backend list returning must not now "revive" what never left.
    const change = await reactor.setBackendPlugins(['catalog']);
    expect(new Set(change.activated).has('@app/shell')).toBe(false);
  });

  it('an unchanged list changes nothing', async () => {
    const reactor = store();
    await reactor.setBackendPlugins(['catalog']);
    const change = await reactor.setBackendPlugins(['catalog']);
    expect(change).toEqual({ deactivated: [], activated: [] });
  });
});
