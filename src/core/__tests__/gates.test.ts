/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Gates: one plugin asking the others whether something may happen.
 */

import { describe, expect, it } from 'vitest';
import {
  buildReactorFromPlugins,
  contribution,
  definePlugin,
  defineGate,
} from '../../index';

type Ctx = { target: string };

const CanChat = defineGate<Ctx>('test.canChat');

function answering(name: string, check: (ctx: Ctx) => true | string) {
  return definePlugin({
    name,
    contributes: [contribution(CanChat, { check }, { id: name })],
  });
}

describe('a gate nobody answers', () => {
  it('allows', () => {
    // A gate no plugin cares about must never be a wall.
    const reactor = buildReactorFromPlugins([]);
    reactor.start();

    expect(reactor.checkGate(CanChat, { target: 'browser' })).toMatchObject({
      allowed: true,
      refusals: [],
    });
  });
});

describe('answers', () => {
  it('allow when every answer allows', () => {
    const reactor = buildReactorFromPlugins([
      answering('@a', () => true),
      answering('@b', () => true),
    ]);
    reactor.start();

    expect(reactor.checkGate(CanChat, { target: 'cloud' }).allowed).toBe(true);
  });

  it('refuse with the first reason, and name who gave it', () => {
    const reactor = buildReactorFromPlugins([
      answering('@a', () => true),
      answering('@b', ctx => (ctx.target === 'browser' ? 'No agent here' : true)),
    ]);
    reactor.start();

    const verdict = reactor.checkGate(CanChat, { target: 'browser' });
    expect(verdict.allowed).toBe(false);
    // One reason is actionable; a list of them is a wall.
    expect(verdict.reason).toBe('No agent here');
    expect(verdict.blockedBy).toBe('@b');
  });

  it('keep every refusal for a host that wants them all', () => {
    const reactor = buildReactorFromPlugins([
      answering('@a', () => 'first'),
      answering('@b', () => 'second'),
    ]);
    reactor.start();

    const verdict = reactor.checkGate(CanChat, { target: 'x' });
    expect(verdict.refusals.map(r => r.reason)).toEqual(['first', 'second']);
    expect(verdict.reason).toBe('first');
  });

  it('read the context the asker passes, on every ask', () => {
    const reactor = buildReactorFromPlugins([
      answering('@a', ctx => (ctx.target === 'browser' ? 'no agent' : true)),
    ]);
    reactor.start();

    expect(reactor.checkGate(CanChat, { target: 'browser' }).allowed).toBe(false);
    // Same gate, same plugins, different context: the answer follows the ask
    // rather than something captured when the plugin started.
    expect(reactor.checkGate(CanChat, { target: 'cloud' }).allowed).toBe(true);
  });
});

describe('a plugin that breaks while answering', () => {
  it('refuses rather than silently allowing', () => {
    // Swallowing this would let a broken plugin wave through whatever it was
    // supposed to be guarding.
    const reactor = buildReactorFromPlugins([
      answering('@boom', () => {
        throw new Error('kaboom');
      }),
    ]);
    reactor.start();

    const verdict = reactor.checkGate(CanChat, { target: 'x' });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('kaboom');
  });
});

describe('disabling the answering plugin', () => {
  it('takes its refusal with it', () => {
    const reactor = buildReactorFromPlugins([
      answering('@veto', () => 'not allowed'),
    ]);
    reactor.start();
    expect(reactor.checkGate(CanChat, { target: 'x' }).allowed).toBe(false);

    // A gate is an extension point, so everything that already works on
    // points — disposal with the extension — works here for free.
    reactor.disable('@veto');
    expect(reactor.checkGate(CanChat, { target: 'x' }).allowed).toBe(true);
  });
});
