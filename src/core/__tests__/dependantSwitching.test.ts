/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Switching a plugin off should switch off what depends on it.
 *
 * `deactivate` has always stood dependants down; `disable` did not, which left
 * a dependant running against an output nobody maintains — and reading
 * `getOutput` for a plugin that has stopped is a crash somewhere with no idea
 * why. The last test here is the one that makes the cascade safe rather than
 * merely tidy.
 */

import { describe, expect, it } from 'vitest';

import { buildReactorFromPlugins } from '../reactor';
import { contribution, defineContributionPoint } from '../contributions';
import { definePlugin } from '../plugin';

/** Something for the dependants to contribute to, so withdrawal is visible. */
const Items = defineContributionPoint<string>('app.items');

function chain() {
  const Base = definePlugin({ name: '@app/base', build: () => 'base' });
  const Middle = definePlugin({
    name: '@app/middle',
    dependencies: [Base],
    build: () => 'middle',
  });
  const Top = definePlugin({
    name: '@app/top',
    dependencies: [Middle],
    build: () => 'top',
    contributes: [contribution(Items, 'from-top', { id: 'top' })],
  });
  const reactor = buildReactorFromPlugins([Base, Middle, Top]);
  reactor.start();
  return reactor;
}

const enabled = (reactor: ReturnType<typeof chain>) =>
  reactor.listPlugins().filter((name) => reactor.isEnabled(name));

describe('disable cascades to dependants', () => {
  it('takes dependants with it, transitively', () => {
    const reactor = chain();
    reactor.disable('@app/base');
    expect(enabled(reactor)).toEqual([]);
    // And what they contributed goes with them, which is the point: a
    // dependant left enabled would keep a view in the switcher that is backed
    // by a plugin that has stopped.
    expect(reactor.getContributions(Items)).toEqual([]);
  });

  it('brings back only what it took', () => {
    const reactor = chain();
    reactor.disable('@app/base');
    reactor.enable('@app/base');
    expect(enabled(reactor)).toEqual(['@app/base', '@app/middle', '@app/top']);
    expect(reactor.getContributions(Items).map((entry) => entry.value)).toEqual([
      'from-top',
    ]);
  });

  it("a person's switch outlives a dependency coming back", () => {
    const reactor = chain();
    // Somebody turned this off deliberately.
    reactor.disable('@app/top');
    // An unrelated act, two plugins away.
    reactor.disable('@app/base');
    reactor.enable('@app/base');

    expect(enabled(reactor)).toEqual(['@app/base', '@app/middle']);
    expect(reactor.getManifest('@app/top')?.disabledBy).toBe('user');
    expect(reactor.getManifest('@app/base')?.disabledBy).toBeUndefined();
  });

  it('says why a plugin is off, so a host can draw the difference', () => {
    const reactor = chain();
    reactor.disable('@app/base');
    expect(reactor.getManifest('@app/base')?.disabledBy).toBe('user');
    expect(reactor.getManifest('@app/middle')?.disabledBy).toBe('dependency');
  });

  it('holds a dependant down while another dependency is still off', () => {
    const A = definePlugin({ name: '@app/a', build: () => 'a' });
    const B = definePlugin({ name: '@app/b', build: () => 'b' });
    const Both = definePlugin({
      name: '@app/both',
      dependencies: [A, B],
      build: () => 'both',
    });
    const reactor = buildReactorFromPlugins([A, B, Both]);
    reactor.start();

    reactor.disable('@app/a');
    reactor.disable('@app/b');
    reactor.enable('@app/a');
    expect(enabled(reactor)).toEqual(['@app/a']);

    reactor.enable('@app/b');
    expect(enabled(reactor)).toEqual(['@app/a', '@app/b', '@app/both']);
  });

  it('wakes subscribers once for the whole cascade', () => {
    const reactor = chain();
    let revisions = 0;
    reactor.subscribe(() => {
      revisions += 1;
    });
    reactor.disable('@app/base');
    // Three plugins stopped; one change. A host re-rendering per plugin would
    // paint the store in a state where half the cascade had happened.
    expect(revisions).toBe(1);
  });
});
