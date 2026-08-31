/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Activation events: a plugin declares when it becomes active, and the reactor
 * holds it until then.
 *
 * The behaviour worth pinning is the one that is easy to get subtly wrong: a
 * plugin woken by an event must still see its dependencies built, even when
 * *they* were waiting on an event of their own. Get that wrong and the bug
 * only appears in an application whose plugin order happens to differ.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildReactorFromPlugins,
  contribution,
  defineContributionPoint,
  defineLazyPlugin,
  definePlugin,
  matchesActivation,
  onCommand,
  onContributionPoint,
  onView,
  ON_ANY,
  ON_STARTUP,
  type ReactorPlugin,
} from '../../index';

type AnyPlugin = ReactorPlugin<any, any, any>;

const Toolbar = defineContributionPoint<{ label: string }>('app.toolbar');

describe('matchesActivation', () => {
  it('treats no declaration as "at startup"', () => {
    expect(matchesActivation(undefined, ON_STARTUP)).toBe(true);
    expect(matchesActivation([], ON_STARTUP)).toBe(true);
    expect(matchesActivation(undefined, onView('notebook'))).toBe(false);
  });

  it('lets "*" match anything, startup included', () => {
    expect(matchesActivation([ON_ANY], ON_STARTUP)).toBe(true);
    expect(matchesActivation([ON_ANY], 'onAnythingAtAll')).toBe(true);
  });

  it('matches exactly, so one event is never a prefix of another', () => {
    // `onView:note` activating on `onView:notebook` is the classic bug here,
    // and it only ever shows up in somebody else's application.
    expect(matchesActivation([onView('note')], onView('notebook'))).toBe(false);
    expect(matchesActivation([onView('notebook')], onView('notebook'))).toBe(true);
  });

  it('does not activate at startup when something else was asked for', () => {
    expect(matchesActivation([onCommand('run')], ON_STARTUP)).toBe(false);
  });
});

describe('a plugin waiting on an event', () => {
  it('does not activate at startup, and does when the event fires', async () => {
    const build = vi.fn(() => ({ ready: true }));
    const Waiting = definePlugin({
      name: '@test/waiting',
      activationEvents: [onView('notebook')],
      build,
    });

    const reactor = buildReactorFromPlugins([Waiting]);
    reactor.start();
    await reactor.whenReady();

    expect(build).not.toHaveBeenCalled();
    expect(reactor.getManifest('@test/waiting')?.activated).toBe(false);
    // Listed and describable the whole time — that is the point of holding the
    // manifest separate from the code.
    expect(reactor.listPlugins()).toContain('@test/waiting');

    await reactor.fire(onView('notebook'));

    expect(build).toHaveBeenCalledTimes(1);
    expect(reactor.getManifest('@test/waiting')?.activated).toBe(true);
    expect(reactor.getOutput('@test/waiting')).toEqual({ ready: true });
  });

  it('contributes nothing until it activates', async () => {
    const Waiting = definePlugin({
      name: '@test/late',
      activationEvents: [onCommand('open')],
      contributes: [contribution(Toolbar, { label: 'Late' })],
    });

    const reactor = buildReactorFromPlugins([Waiting]);
    reactor.start();

    expect(reactor.getContributions(Toolbar)).toEqual([]);

    await reactor.fire(onCommand('open'));

    expect(reactor.getContributions(Toolbar).map((entry) => entry.value.label)).toEqual([
      'Late',
    ]);
  });

  it('is ignored by an event nobody declared', async () => {
    const build = vi.fn(() => ({}));
    const reactor = buildReactorFromPlugins([
      definePlugin({ name: '@test/x', activationEvents: [onView('a')], build }),
    ]);
    reactor.start();

    await reactor.fire(onView('b'));

    expect(build).not.toHaveBeenCalled();
    // Firing into the void is free, and must not throw — applications fire
    // liberally rather than checking first.
    await expect(reactor.fire('onNothing')).resolves.toEqual({
      activated: [],
      deactivated: [],
    });
  });

  it('activates only once, however many events match', async () => {
    const build = vi.fn(() => ({}));
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@test/twice',
        activationEvents: [onView('a'), onView('b')],
        build,
      }),
    ]);
    reactor.start();

    await reactor.fire(onView('a'));
    await reactor.fire(onView('b'));

    expect(build).toHaveBeenCalledTimes(1);
  });
});

describe('dependencies of a plugin woken by an event', () => {
  it('are activated first, even when they were waiting themselves', async () => {
    const order: string[] = [];
    const Dependency = definePlugin({
      name: '@test/dependency',
      // Waiting on an event that never fires: it must still come up, because
      // something that needs it did.
      activationEvents: [onView('never')],
      build: () => {
        order.push('dependency');
        return { value: 'dep' };
      },
    });
    const Dependant = definePlugin({
      name: '@test/dependant',
      dependencies: [Dependency],
      activationEvents: [onView('now')],
      build: (ctx) => {
        order.push('dependant');
        // The real assertion: what it depends on has already built.
        return { saw: ctx.reactor.getOutput('@test/dependency') };
      },
    });

    const reactor = buildReactorFromPlugins([Dependant]);
    reactor.start();
    expect(order).toEqual([]);

    await reactor.fire(onView('now'));

    expect(order).toEqual(['dependency', 'dependant']);
    expect(reactor.getOutput('@test/dependant')).toEqual({
      saw: { value: 'dep' },
    });
  });
});

describe('reading a contribution point', () => {
  it('activates the plugins that were waiting on it', async () => {
    const Waiting = definePlugin({
      name: '@test/on-read',
      activationEvents: [onContributionPoint(Toolbar)],
      contributes: [contribution(Toolbar, { label: 'Woken' })],
    });

    const reactor = buildReactorFromPlugins([Waiting]);
    reactor.start();

    // The first read is synchronous and answers with what is there now —
    // nothing — while firing the event that fills it.
    expect(reactor.getContributions(Toolbar)).toEqual([]);
    await reactor.whenReady();
    await Promise.resolve();
    await Promise.resolve();

    expect(reactor.getContributions(Toolbar).map((entry) => entry.value.label)).toEqual([
      'Woken',
    ]);
  });

  it('bumps the revision when the late arrival lands, so hosts re-render', async () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@test/on-read-2',
        activationEvents: [onContributionPoint(Toolbar)],
        contributes: [contribution(Toolbar, { label: 'Woken' })],
      }),
    ]);
    reactor.start();
    const before = reactor.getRevision();

    reactor.getContributions(Toolbar);
    await Promise.resolve();
    await Promise.resolve();

    expect(reactor.getRevision()).toBeGreaterThan(before);
  });
});

describe('a lazy plugin with activation events', () => {
  it('is not fetched until one of them fires', async () => {
    const load = vi.fn(async () => ({
      default: definePlugin({
        name: '@test/lazy-event',
        contributes: [contribution(Toolbar, { label: 'Lazy' })],
      }) as AnyPlugin,
    }));
    const Lazy = defineLazyPlugin({
      name: '@test/lazy-event',
      displayName: 'Lazy on demand',
      activationEvents: [onView('heavy')],
      load,
    });

    const reactor = buildReactorFromPlugins([Lazy]);
    reactor.start();
    await reactor.whenReady();

    // The whole point: no request at all, while the plugin is still listed,
    // named and drawable.
    expect(load).not.toHaveBeenCalled();
    expect(reactor.getManifest('@test/lazy-event')).toMatchObject({
      displayName: 'Lazy on demand',
      lazy: true,
      loaded: false,
      activated: false,
    });

    await reactor.fire(onView('heavy'));

    expect(load).toHaveBeenCalledTimes(1);
    expect(reactor.getManifest('@test/lazy-event')).toMatchObject({
      loaded: true,
      activated: true,
    });
    expect(reactor.getContributions(Toolbar)).toHaveLength(1);
  });

  it('still loads at startup when it declares nothing', async () => {
    const load = vi.fn(async () => ({
      default: definePlugin({ name: '@test/lazy-default' }) as AnyPlugin,
    }));
    const reactor = buildReactorFromPlugins([
      defineLazyPlugin({ name: '@test/lazy-default', load }),
    ]);
    reactor.start();
    await reactor.whenReady();

    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('the manifest', () => {
  it('reports the activation events, defaulting to startup', () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({ name: '@test/plain' }),
      definePlugin({ name: '@test/declared', activationEvents: [onView('x')] }),
    ]);
    reactor.start();

    expect(reactor.getManifest('@test/plain')?.activationEvents).toEqual([ON_STARTUP]);
    expect(reactor.getManifest('@test/declared')?.activationEvents).toEqual([
      'onView:x',
    ]);
  });

  it('reports the points a plugin offers and the ones it declares into', () => {
    const Offered = defineContributionPoint<{ n: number }>('app.offered');
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@test/manifest',
        contributionPoints: [Offered],
        contributes: [contribution(Toolbar, { label: 'A' })],
      }),
    ]);
    reactor.start();

    const manifest = reactor.getManifest('@test/manifest');
    expect(manifest?.contributionPoints).toEqual(['app.offered']);
    expect(manifest?.contributesTo).toEqual(['app.toolbar']);
  });
});
