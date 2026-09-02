/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { describe, expect, it, vi } from 'vitest';
import { buildReactorFromPlugins, definePlugin } from '../../index';

describe('commands', () => {
  it('registers what a plugin declares', () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@tests/music',
        commands: [
          {
            id: 'music.play',
            name: 'Play',
            description: 'Start playing',
            emoji: '▶️',
            execute: () => {},
          },
        ],
      }),
    ]);
    reactor.start();

    expect(reactor.listCommands().map((c) => c.id)).toEqual(['music.play']);
    const command = reactor.getCommand('music.play');
    expect(command?.name).toBe('Play');
    expect(command?.emoji).toBe('▶️');
    // The registering plugin travels with the command, so a palette can say
    // where a command came from.
    expect(command?.plugin).toBe('@tests/music');
  });

  it('runs a command and awaits an async one', async () => {
    const ran: string[] = [];
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@tests/async',
        commands: [
          {
            id: 'slow',
            name: 'Slow',
            execute: async () => {
              await Promise.resolve();
              ran.push('slow');
            },
          },
        ],
      }),
    ]);
    reactor.start();

    await reactor.executeCommand('slow');
    expect(ran).toEqual(['slow']);
  });

  it('passes an argument through to execute', async () => {
    const seen: unknown[] = [];
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@tests/arg',
        commands: [
          {
            id: 'echo',
            name: 'Echo',
            execute: (value: string) => {
              seen.push(value);
            },
          },
        ],
      }),
    ]);
    reactor.start();

    await reactor.executeCommand('echo', 'hello');
    expect(seen).toEqual(['hello']);
  });

  it('orders by order then by registration', () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@tests/ordering',
        commands: [
          { id: 'c', name: 'C', execute: () => {} },
          { id: 'a', name: 'A', order: -10, execute: () => {} },
          { id: 'd', name: 'D', execute: () => {} },
        ],
      }),
    ]);
    reactor.start();

    expect(reactor.listCommands().map((c) => c.id)).toEqual(['a', 'c', 'd']);
  });

  it('refuses a duplicate id rather than overwriting silently', () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@tests/first',
        commands: [{ id: 'clash', name: 'First', execute: () => {} }],
      }),
      definePlugin({
        name: '@tests/second',
        commands: [{ id: 'clash', name: 'Second', execute: () => {} }],
      }),
    ]);

    expect(() => reactor.start()).toThrow(/already registered by plugin '@tests\/first'/);
  });

  it('rejects an unknown command', async () => {
    const reactor = buildReactorFromPlugins([definePlugin({ name: '@tests/empty' })]);
    reactor.start();

    await expect(reactor.executeCommand('nope')).rejects.toThrow(/no command 'nope'/);
  });

  it('lists an unavailable command but refuses to run it', async () => {
    let allowed = false;
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@tests/gated',
        commands: [
          {
            id: 'gated',
            name: 'Gated',
            isEnabled: () => allowed,
            execute: () => {},
          },
        ],
      }),
    ]);
    reactor.start();

    // Listed even while unavailable: a command that vanishes looks like a lost
    // feature, and saying why is more useful than pretending it never existed.
    expect(reactor.listCommands().map((c) => c.id)).toEqual(['gated']);
    await expect(reactor.executeCommand('gated')).rejects.toThrow(/not available right now/);

    allowed = true;
    await expect(reactor.executeCommand('gated')).resolves.toBeUndefined();
  });

  it('surfaces what a command throws', async () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@tests/throws',
        commands: [
          {
            id: 'boom',
            name: 'Boom',
            execute: () => {
              throw new Error('the command failed');
            },
          },
        ],
      }),
    ]);
    reactor.start();

    await expect(reactor.executeCommand('boom')).rejects.toThrow('the command failed');
  });

  it('registers imperatively from a phase, closing over build output', async () => {
    const ran: string[] = [];
    const reactor = buildReactorFromPlugins([
      definePlugin<Record<string, never>, unknown, { greeting: string }>({
        name: '@tests/imperative',
        build: () => ({ greeting: 'from the build' }),
        register(ctx) {
          const built = ctx.state.getOutput();
          return ctx.registerCommand({
            id: 'imperative',
            name: 'Imperative',
            execute: () => {
              ran.push(built!.greeting);
            },
          });
        },
      }),
    ]);
    reactor.start();

    await reactor.executeCommand('imperative');
    expect(ran).toEqual(['from the build']);
  });

  it('drops a plugin\'s commands when it is disabled, and brings them back', () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@tests/toggles',
        commands: [{ id: 'toggles', name: 'Toggles', execute: () => {} }],
      }),
    ]);
    reactor.start();
    expect(reactor.listCommands()).toHaveLength(1);

    reactor.disable('@tests/toggles');
    expect(reactor.listCommands()).toHaveLength(0);

    reactor.enable('@tests/toggles');
    expect(reactor.listCommands().map((c) => c.id)).toEqual(['toggles']);
  });

  it('wakes subscribers when the set of commands changes', () => {
    const listener = vi.fn();
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@tests/subscribed',
        commands: [{ id: 'sub', name: 'Sub', execute: () => {} }],
      }),
    ]);
    reactor.start();

    reactor.subscribe(listener);
    const before = reactor.getRevision();
    reactor.disable('@tests/subscribed');

    expect(listener).toHaveBeenCalled();
    expect(reactor.getRevision()).not.toBe(before);
  });
});
