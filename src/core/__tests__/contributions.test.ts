/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { describe, expect, it } from 'vitest';
import {
  buildReactorFromPlugins,
  contribution,
  definePlugin,
  defineContributionPoint,
  type Dispose,
  type PhaseContext,
} from '../../index';

type View = { title: string };
type Command = { name: string };

const ViewPoint = defineContributionPoint<View>('tests.view');
const CommandPoint = defineContributionPoint<Command>('tests.command');

describe('extension points', () => {
  it('keeps contributions to different points apart', () => {
    const Extension = definePlugin({
      name: '@tests/both',
      contributes: [
        contribution(ViewPoint, { title: 'Notebook' }, { id: 'notebook' }),
        contribution(CommandPoint, { name: 'open' }, { id: 'open' }),
      ],
    });

    const reactor = buildReactorFromPlugins([Extension]);
    reactor.start();

    expect(reactor.getContributions(ViewPoint).map((c) => c.value.title)).toEqual([
      'Notebook',
    ]);
    expect(reactor.getContributions(CommandPoint).map((c) => c.value.name)).toEqual([
      'open',
    ]);
  });

  it('returns an empty list for a point nobody contributed to', () => {
    const reactor = buildReactorFromPlugins([definePlugin({ name: '@tests/none' })]);
    reactor.start();

    expect(reactor.getContributions(ViewPoint)).toEqual([]);
  });

  it('orders by `order`, then by contribution order', () => {
    const First = definePlugin({
      name: '@tests/first',
      contributes: [
        contribution(ViewPoint, { title: 'b' }, { id: 'b', order: 10 }),
        contribution(ViewPoint, { title: 'a' }, { id: 'a', order: -5 }),
      ],
    });
    const Second = definePlugin({
      name: '@tests/second',
      contributes: [
        // Same order as 'b': registration order decides, and it registers later.
        contribution(ViewPoint, { title: 'c' }, { id: 'c', order: 10 }),
      ],
    });

    const reactor = buildReactorFromPlugins([First, Second]);
    reactor.start();

    expect(reactor.getContributions(ViewPoint).map((c) => c.value.title)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('defaults a contribution id to the extension name', () => {
    const Extension = definePlugin({
      name: '@tests/anonymous',
      contributes: [contribution(ViewPoint, { title: 'Anonymous' })],
    });

    const reactor = buildReactorFromPlugins([Extension]);
    reactor.start();

    expect(reactor.getContributions(ViewPoint)[0]?.id).toBe('@tests/anonymous');
    expect(reactor.getContributions(ViewPoint)[0]?.plugin).toBe('@tests/anonymous');
  });

  it('accepts contributions made after start and bumps the revision', () => {
    let contribute: PhaseContext<any, any, any>['contribute'] | undefined;
    const Extension = definePlugin({
      name: '@tests/late',
      register(ctx) {
        contribute = ctx.contribute;
      },
    });

    const reactor = buildReactorFromPlugins([Extension]);
    reactor.start();

    expect(reactor.getContributions(ViewPoint)).toHaveLength(0);
    const revisionBefore = reactor.getRevision();

    contribute?.(ViewPoint, { title: 'Late' }, { id: 'late' });

    expect(reactor.getContributions(ViewPoint).map((c) => c.value.title)).toEqual([
      'Late',
    ]);
    expect(reactor.getRevision()).toBeGreaterThan(revisionBefore);
  });

  it('withdraws a contribution through its disposer', () => {
    let dispose: Dispose | undefined;
    const Extension = definePlugin({
      name: '@tests/disposable',
      register(ctx) {
        dispose = ctx.contribute(ViewPoint, { title: 'Temporary' }, { id: 'tmp' });
      },
    });

    const reactor = buildReactorFromPlugins([Extension]);
    reactor.start();
    expect(reactor.getContributions(ViewPoint)).toHaveLength(1);

    const revisionBefore = reactor.getRevision();
    dispose?.();

    expect(reactor.getContributions(ViewPoint)).toHaveLength(0);
    expect(reactor.getRevision()).toBeGreaterThan(revisionBefore);

    // Idempotent, notification included: a second call removes nothing, so it
    // wakes nobody. Emitting again would re-render every subscriber for a
    // change that did not happen.
    const revisionAfterFirst = reactor.getRevision();
    dispose?.();
    expect(reactor.getContributions(ViewPoint)).toHaveLength(0);
    expect(reactor.getRevision()).toBe(revisionAfterFirst);
  });

  it('drops an extension’s contributions when it is disabled, and restores them on enable', () => {
    const Kept = definePlugin({
      name: '@tests/kept',
      contributes: [contribution(ViewPoint, { title: 'Kept' }, { id: 'kept' })],
    });
    const Toggled = definePlugin({
      name: '@tests/toggled',
      contributes: [contribution(ViewPoint, { title: 'Toggled' }, { id: 'toggled' })],
    });

    const reactor = buildReactorFromPlugins([Kept, Toggled]);
    reactor.start();
    expect(reactor.getContributions(ViewPoint)).toHaveLength(2);

    reactor.disable('@tests/toggled');
    expect(reactor.getContributions(ViewPoint).map((c) => c.id)).toEqual(['kept']);

    reactor.enable('@tests/toggled');
    expect(reactor.getContributions(ViewPoint).map((c) => c.id).sort()).toEqual([
      'kept',
      'toggled',
    ]);
  });

  it('drops every contribution on stop, and does not duplicate them on restart', () => {
    const Extension = definePlugin({
      name: '@tests/lifecycle',
      contributes: [contribution(ViewPoint, { title: 'View' }, { id: 'view' })],
    });

    const reactor = buildReactorFromPlugins([Extension]);
    reactor.start();
    expect(reactor.getContributions(ViewPoint)).toHaveLength(1);

    reactor.stop();
    expect(reactor.getContributions(ViewPoint)).toHaveLength(0);

    reactor.start();
    expect(reactor.getContributions(ViewPoint)).toHaveLength(1);
  });

  it('emits one change for a start, not one per contribution', () => {
    const Extension = definePlugin({
      name: '@tests/batched',
      contributes: [
        contribution(ViewPoint, { title: 'one' }, { id: 'one' }),
        contribution(ViewPoint, { title: 'two' }, { id: 'two' }),
        contribution(ViewPoint, { title: 'three' }, { id: 'three' }),
      ],
    });

    const reactor = buildReactorFromPlugins([Extension]);
    let notifications = 0;
    reactor.subscribe(() => {
      notifications += 1;
    });

    reactor.start();

    expect(reactor.getContributions(ViewPoint)).toHaveLength(3);
    expect(notifications).toBe(1);
  });

  it('lets an extension contribute what a dependency built', () => {
    const Base = definePlugin({
      name: '@tests/base',
      build() {
        return { title: 'From base' };
      },
    });
    const Consumer = definePlugin({
      name: '@tests/consumer',
      dependencies: [Base],
      register(ctx) {
        const output = ctx.reactor.getOutput<{ title: string }>('@tests/base');
        ctx.contribute(ViewPoint, { title: output?.title ?? 'missing' }, { id: 'derived' });
      },
    });

    const reactor = buildReactorFromPlugins([Consumer]);
    reactor.start();

    expect(reactor.getContributions(ViewPoint)[0]?.value.title).toBe('From base');
  });
});

describe('extensions that own something', () => {
  it('are rebuilt on enable by default', () => {
    let builds = 0;
    const Extension = definePlugin({
      name: '@tests/stateless',
      build() {
        builds += 1;
        return { instance: builds };
      },
    });

    const reactor = buildReactorFromPlugins([Extension]);
    reactor.start();
    reactor.disable('@tests/stateless');
    reactor.enable('@tests/stateless');

    // Right for an extension that only contributes records: it comes back clean.
    expect(builds).toBe(2);
    expect(reactor.getOutput<{ instance: number }>('@tests/stateless')?.instance).toBe(2);
  });

  it('keep what they built when they ask to', () => {
    let builds = 0;
    const Extension = definePlugin({
      name: '@tests/stateful',
      preserveOutput: true,
      build() {
        builds += 1;
        return { connection: `connection-${builds}` };
      },
    });

    const reactor = buildReactorFromPlugins([Extension]);
    reactor.start();
    const before = reactor.getOutput<{ connection: string }>('@tests/stateful');

    reactor.disable('@tests/stateful');
    reactor.enable('@tests/stateful');

    // The same object, so anything holding it is not left detached.
    expect(builds).toBe(1);
    expect(reactor.getOutput('@tests/stateful')).toBe(before);
  });

  it('still re-register, so their contributions come back', () => {
    const Extension = definePlugin({
      name: '@tests/stateful-contributor',
      preserveOutput: true,
      build() {
        return { held: true };
      },
      contributes: [contribution(ViewPoint, { title: 'Held' }, { id: 'held' })],
    });

    const reactor = buildReactorFromPlugins([Extension]);
    reactor.start();
    reactor.disable('@tests/stateful-contributor');
    expect(reactor.getContributions(ViewPoint)).toHaveLength(0);

    reactor.enable('@tests/stateful-contributor');
    expect(reactor.getContributions(ViewPoint).map(c => c.id)).toEqual(['held']);
  });

  it('build normally the first time, however they are flagged', () => {
    const Extension = definePlugin({
      name: '@tests/first-build',
      preserveOutput: true,
      build() {
        return { built: true };
      },
    });

    const reactor = buildReactorFromPlugins([Extension]);
    reactor.start();

    expect(reactor.getOutput('@tests/first-build')).toEqual({ built: true });
  });
});
