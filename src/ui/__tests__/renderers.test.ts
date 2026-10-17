/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

import { describe, expect, it } from 'vitest';
import { buildReactorFromPlugins, contribution, definePlugin } from '../../index';
import {
  Renderers,
  ToolBindings,
  resolveRenderer,
  resolveToolResult,
  type RendererContribution,
  type ToolBinding,
} from '../renderers';
import { DISPLAY_META_KEY } from '../wire';

const TYPE = 'application/vnd.tests.card+json';

function rendererPlugin(name: string, renderer: Omit<RendererContribution<string>, 'type'> & { type?: string }) {
  return definePlugin({
    name,
    contributes: [contribution(Renderers, { type: TYPE, ...renderer }, { id: name })],
  });
}

function bindingPlugin(name: string, binding: ToolBinding) {
  return definePlugin({ name, contributes: [contribution(ToolBindings, binding, { id: name })] });
}

const display = (version = 1) => ({ type: TYPE, version, id: 'd', text: 'card' });

describe('resolveRenderer', () => {
  it('takes the highest rank', () => {
    const reactor = buildReactorFromPlugins([
      rendererPlugin('@tests/plain', { component: 'plain' }),
      rendererPlugin('@tests/fancy', { component: 'fancy', rank: 10 }),
    ]);
    reactor.start();
    expect(resolveRenderer(reactor, display())?.value.component).toBe('fancy');
  });

  it('keeps the first registered on a tie', () => {
    const reactor = buildReactorFromPlugins([
      rendererPlugin('@tests/first', { component: 'first', rank: 1 }),
      rendererPlugin('@tests/second', { component: 'second', rank: 1 }),
    ]);
    reactor.start();
    expect(resolveRenderer(reactor, display())?.value.component).toBe('first');
  });

  it('admits only versions in range', () => {
    const reactor = buildReactorFromPlugins([
      rendererPlugin('@tests/v1', { component: 'v1', versions: { max: 1 }, rank: 5 }),
      rendererPlugin('@tests/v2', { component: 'v2', versions: { min: 2, max: 3 } }),
    ]);
    reactor.start();
    expect(resolveRenderer(reactor, display(1))?.value.component).toBe('v1');
    expect(resolveRenderer(reactor, display(3))?.value.component).toBe('v2');
    expect(resolveRenderer(reactor, display(4))).toBeUndefined();
    expect(resolveRenderer(reactor, { type: 'application/vnd.other+json' })).toBeUndefined();
  });

  it('forgets a disabled plugin and finds it again when enabled', () => {
    const reactor = buildReactorFromPlugins([
      rendererPlugin('@tests/base', { component: 'base' }),
      rendererPlugin('@tests/better', { component: 'better', rank: 2 }),
    ]);
    reactor.start();
    reactor.disable('@tests/better');
    expect(resolveRenderer(reactor, display())?.value.component).toBe('base');
    reactor.enable('@tests/better');
    expect(resolveRenderer(reactor, display())?.value.component).toBe('better');
  });
});

describe('resolveToolResult', () => {
  const embedded = { type: 'application/vnd.tests.embedded+json', version: 1, id: 'e1', text: 'embedded' };

  it('prefers the display a result embeds over a binding', () => {
    const reactor = buildReactorFromPlugins([bindingPlugin('@tests/bind', { tool: 'sign_in', type: TYPE })]);
    reactor.start();
    const result = { content: [], _meta: { [DISPLAY_META_KEY]: embedded } };
    expect(resolveToolResult(reactor, { toolName: 'sign_in', result })).toEqual(embedded);
    expect(resolveToolResult(reactor, { toolName: 'sign_in', result: JSON.stringify(result) })).toEqual(embedded);
  });

  it('wraps a bound tool result as a display of the bound type', () => {
    const reactor = buildReactorFromPlugins([
      bindingPlugin('@tests/exact', { tool: 'render_card', type: TYPE }),
      bindingPlugin('@tests/pattern', { tool: /(^|[_.:\-/])sign_in$/, type: 'application/vnd.tests.sign-in+json' }),
    ]);
    reactor.start();
    expect(resolveToolResult(reactor, { toolName: 'render_card', toolCallId: 'c1', result: { a: 1 } })).toEqual({
      type: TYPE,
      version: 1,
      id: 'c1',
      text: '{"a":1}',
      data: { toolName: 'render_card', result: { a: 1 } },
    });
    expect(resolveToolResult(reactor, { toolName: 'gateway.sign_in' })?.type).toBe(
      'application/vnd.tests.sign-in+json',
    );
    expect(resolveToolResult(reactor, { toolName: 'resign_in' })).toBeUndefined();
  });

  it('reads a result JSON cannot write as a string, never undefined', () => {
    const reactor = buildReactorFromPlugins([bindingPlugin('@tests/exact', { tool: 'render_card', type: TYPE })]);
    reactor.start();
    const result = function unserializable() {
      return 1;
    };
    const text = resolveToolResult(reactor, { toolName: 'render_card', result })?.text;
    expect(typeof text).toBe('string');
    expect(text).toBe(String(result));
    expect(resolveToolResult(reactor, { toolName: 'render_card', result: Symbol('s') })?.text).toBe('Symbol(s)');
  });

  it('leaves an unbound tool to the host', () => {
    const reactor = buildReactorFromPlugins([bindingPlugin('@tests/bind', { tool: 'render_card', type: TYPE })]);
    reactor.start();
    expect(resolveToolResult(reactor, { toolName: 'read_cell', result: 'x' })).toBeUndefined();
    reactor.disable('@tests/bind');
    expect(resolveToolResult(reactor, { toolName: 'render_card', result: 'x' })).toBeUndefined();
  });
});
