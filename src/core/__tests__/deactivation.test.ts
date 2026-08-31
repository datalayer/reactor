/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Deactivation: the same idea as activation, run backwards.
 *
 * The distinction these pin down is the one that is easy to collapse:
 * *disabled* is a person's decision and it sticks, *deactivated* is the
 * platform saying the reason for running has passed. Collapse them and either
 * an event silently overrides somebody's checkbox, or a plugin that stood down
 * can never come back.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildReactorFromPlugins,
  contribution,
  defineContributionPoint,
  defineLazyPlugin,
  definePlugin,
  matchesDeactivation,
  onCommand,
  onContributionPoint,
  onView,
  ON_ANY,
  ON_STARTUP,
  type ReactorPlugin,
} from '../../index';

type AnyPlugin = ReactorPlugin<any, any, any>;

const Toolbar = defineContributionPoint<{ label: string }>('app.toolbar');

describe('matchesDeactivation', () => {
  it('never fires when nothing is declared', () => {
    // The asymmetry with activation, and the whole reason for a second
    // function: an empty activation list means "at startup", an empty
    // deactivation list means never. Point both at the same default and every
    // plugin that said nothing is torn down by the first event fired.
    expect(matchesDeactivation(undefined, ON_STARTUP)).toBe(false);
    expect(matchesDeactivation([], onView('x'))).toBe(false);
  });

  it('matches what it declares, and "*" matches anything', () => {
    expect(matchesDeactivation([onView('x')], onView('x'))).toBe(true);
    expect(matchesDeactivation([onView('x')], onView('y'))).toBe(false);
    expect(matchesDeactivation([ON_ANY], 'onWhatever')).toBe(true);
  });
});

describe('deactivate', () => {
  it('drops what the plugin contributed and runs its disposers', () => {
    const dispose = vi.fn();
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@test/live',
        contributes: [contribution(Toolbar, { label: 'Live' })],
        register: () => dispose,
      }),
    ]);
    reactor.start();
    expect(reactor.getContributions(Toolbar)).toHaveLength(1);

    reactor.deactivate('@test/live');

    expect(reactor.getContributions(Toolbar)).toEqual([]);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(reactor.getManifest('@test/live')?.activated).toBe(false);
  });

  it('leaves the plugin installed, enabled and loaded', () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({ name: '@test/live' }),
    ]);
    reactor.start();

    reactor.deactivate('@test/live');

    // Standing down is not uninstalling and not switching off: the plugin is
    // still listed, still ticked, and its module is still here.
    expect(reactor.listPlugins()).toContain('@test/live');
    expect(reactor.isEnabled('@test/live')).toBe(true);
    expect(reactor.getManifest('@test/live')?.loaded).toBe(true);
  });

  it('is a no-op on a plugin that was never activated', () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({ name: '@test/waiting', activationEvents: [onView('x')] }),
    ]);
    reactor.start();

    expect(() => reactor.deactivate('@test/waiting')).not.toThrow();
    expect(reactor.getManifest('@test/waiting')?.activated).toBe(false);
  });

  it('refuses a name it has never heard of', () => {
    const reactor = buildReactorFromPlugins([definePlugin({ name: '@test/a' })]);
    reactor.start();

    expect(() => reactor.deactivate('@test/nope')).toThrow(/Unknown plugin/);
  });

  it('stands dependants down first, transitively', () => {
    const order: string[] = [];
    const Base = definePlugin({
      name: '@test/base',
      register: () => () => order.push('base'),
    });
    const Middle = definePlugin({
      name: '@test/middle',
      dependencies: [Base],
      register: () => () => order.push('middle'),
    });
    const Top = definePlugin({
      name: '@test/top',
      dependencies: [Middle],
      register: () => () => order.push('top'),
    });

    const reactor = buildReactorFromPlugins([Top]);
    reactor.start();
    reactor.deactivate('@test/base');

    // Furthest dependant first: nothing is torn down while something still
    // holding its output is running.
    expect(order).toEqual(['top', 'middle', 'base']);
    expect(reactor.getManifest('@test/top')?.activated).toBe(false);
  });
});

describe('deactivation events', () => {
  it('stand a plugin down when one fires', async () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@test/transient',
        deactivationEvents: [onView('away')],
        contributes: [contribution(Toolbar, { label: 'Here' })],
      }),
    ]);
    reactor.start();
    expect(reactor.getContributions(Toolbar)).toHaveLength(1);

    const fired = await reactor.fire(onView('away'));

    expect(fired.deactivated).toEqual(['@test/transient']);
    expect(reactor.getContributions(Toolbar)).toEqual([]);
  });

  it('leave a plugin that declared none alone', async () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@test/steady',
        contributes: [contribution(Toolbar, { label: 'Steady' })],
      }),
    ]);
    reactor.start();

    await reactor.fire(onView('away'));

    expect(reactor.getContributions(Toolbar)).toHaveLength(1);
  });

  it('let one event retire one plugin and bring up another', async () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@test/document-mode',
        deactivationEvents: [onView('notebook')],
        contributes: [contribution(Toolbar, { label: 'Document' })],
      }),
      definePlugin({
        name: '@test/notebook-mode',
        activationEvents: [onView('notebook')],
        contributes: [contribution(Toolbar, { label: 'Notebook' })],
      }),
    ]);
    reactor.start();
    expect(reactor.getContributions(Toolbar).map(e => e.value.label)).toEqual([
      'Document',
    ]);

    const fired = await reactor.fire(onView('notebook'));

    // Down before up, in one call: the other order leaves both running for a
    // beat, which a host reading the point in between would see.
    expect(fired).toEqual({
      deactivated: ['@test/document-mode'],
      activated: ['@test/notebook-mode'],
    });
    expect(reactor.getContributions(Toolbar).map(e => e.value.label)).toEqual([
      'Notebook',
    ]);
  });
});

describe('a plugin that stood down', () => {
  it('comes back when an activation event fires again', async () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@test/cycle',
        activationEvents: [onView('in')],
        deactivationEvents: [onView('out')],
        contributes: [contribution(Toolbar, { label: 'Cycled' })],
      }),
    ]);
    reactor.start();

    await reactor.fire(onView('in'));
    expect(reactor.getContributions(Toolbar)).toHaveLength(1);
    await reactor.fire(onView('out'));
    expect(reactor.getContributions(Toolbar)).toEqual([]);
    await reactor.fire(onView('in'));

    // Exactly once, not twice: coming back must not double what it contributes.
    expect(reactor.getContributions(Toolbar)).toHaveLength(1);
  });

  it('can be woken again by a read of the point it waits on', async () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@test/on-read',
        activationEvents: [onContributionPoint(Toolbar)],
        deactivationEvents: [onCommand('close')],
        contributes: [contribution(Toolbar, { label: 'Read' })],
      }),
    ]);
    reactor.start();

    reactor.getContributions(Toolbar);
    await Promise.resolve();
    await Promise.resolve();
    expect(reactor.getContributions(Toolbar)).toHaveLength(1);

    await reactor.fire(onCommand('close'));
    expect(reactor.getContributions(Toolbar)).toEqual([]);

    // A point fires its activation event once, so a failed module is not
    // re-fetched every render. Standing down has to lift that for this point,
    // or a plugin woken by a read could never be woken by one again.
    reactor.getContributions(Toolbar);
    await Promise.resolve();
    await Promise.resolve();
    expect(reactor.getContributions(Toolbar)).toHaveLength(1);
  });

  it('keeps what it built when it says it owns something', async () => {
    let built = 0;
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@test/owner',
        preserveOutput: true,
        activationEvents: [ON_STARTUP],
        deactivationEvents: [onView('out')],
        build: () => ({ id: ++built }),
      }),
    ]);
    reactor.start();
    const original = reactor.getOutput('@test/owner');

    await reactor.fire(onView('out'));
    await reactor.fire(ON_STARTUP);

    // The same instance: rebuilding would hand back a new one while whatever
    // captured the first carries on holding a detached object.
    expect(built).toBe(1);
    expect(reactor.getOutput('@test/owner')).toBe(original);
  });

  it('is not revived by an event while it is disabled', async () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@test/off',
        activationEvents: [onView('in')],
        contributes: [contribution(Toolbar, { label: 'Off' })],
      }),
    ]);
    reactor.start();
    reactor.disable('@test/off');

    await reactor.fire(onView('in'));

    // A person's decision outranks an event. The condition is recorded — the
    // plugin is activated — but nothing runs until it is enabled again.
    expect(reactor.getContributions(Toolbar)).toEqual([]);
    expect(reactor.isEnabled('@test/off')).toBe(false);

    reactor.enable('@test/off');
    expect(reactor.getContributions(Toolbar)).toHaveLength(1);
  });

  it('does not keep its module on the wire twice', async () => {
    const load = vi.fn(async () => ({
      default: definePlugin({
        name: '@test/lazy-cycle',
        contributes: [contribution(Toolbar, { label: 'Lazy' })],
      }) as AnyPlugin,
    }));
    const reactor = buildReactorFromPlugins([
      defineLazyPlugin({
        name: '@test/lazy-cycle',
        activationEvents: [onView('in')],
        deactivationEvents: [onView('out')],
        load,
      }),
    ]);
    reactor.start();

    await reactor.fire(onView('in'));
    await reactor.fire(onView('out'));
    await reactor.fire(onView('in'));

    // Standing down keeps the module: refetching it would make deactivation a
    // more expensive way of doing nothing.
    expect(load).toHaveBeenCalledTimes(1);
    expect(reactor.getContributions(Toolbar)).toHaveLength(1);
  });
});
