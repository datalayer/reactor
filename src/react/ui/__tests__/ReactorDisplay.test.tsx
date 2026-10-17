/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildReactorFromPlugins, contribution, definePlugin, type ReactorPlatform } from '../../../index';
import { Renderers } from '../../../ui/renderers';
import type { Display, UiOp } from '../../../ui/wire';
import { registerReactor, useReactor } from '../../reactor';
import { ReactorDisplay, defineRenderer, type RendererProps } from '../ReactorDisplay';
import { useUiChannel } from '../useUiChannel';

const TYPE = 'application/vnd.tests.card+json';
const card: Display = { type: TYPE, version: 1, id: 'c', text: 'plain text', data: { title: 'Card' } };

let container: HTMLDivElement;
let root: Root | null = null;

function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const created = createRoot(container);
  root = created;
  act(() => {
    created.render(<>{node}</>);
  });
}

function Harness({ reactor, children }: { reactor: ReactorPlatform; children: React.ReactNode }) {
  useReactor(reactor, { autoStart: true });
  return <>{children}</>;
}

function Card({ display, context }: RendererProps<{ who: string }>) {
  return (
    <b>
      {String(display.data?.title)} for {context?.who}
    </b>
  );
}

beforeEach(() => {
  registerReactor(null);
});

afterEach(() => {
  const mounted = root;
  if (mounted) {
    act(() => mounted.unmount());
    root = null;
  }
  container?.remove();
});

describe('ReactorDisplay', () => {
  it('draws the text when no renderer claims the display', () => {
    const reactor = buildReactorFromPlugins([definePlugin({ name: '@tests/none' })]);
    mount(
      <Harness reactor={reactor}>
        <ReactorDisplay display={card} />
      </Harness>,
    );
    expect(container.textContent).toBe('plain text');
  });

  it('draws with the contributed renderer, and stops when its plugin is disabled', () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@tests/card',
        contributes: [contribution(Renderers, defineRenderer({ type: TYPE, component: Card }))],
      }),
    ]);
    mount(
      <Harness reactor={reactor}>
        <ReactorDisplay display={card} context={{ who: 'Ada' }} />
      </Harness>,
    );
    expect(container.textContent).toBe('Card for Ada');
    act(() => reactor.disable('@tests/card'));
    expect(container.textContent).toBe('plain text');
  });

  it('loads a lazy renderer', async () => {
    const reactor = buildReactorFromPlugins([
      definePlugin({
        name: '@tests/lazy',
        contributes: [
          contribution(Renderers, defineRenderer({ type: TYPE, load: async () => ({ default: Card }) })),
        ],
      }),
    ]);
    mount(
      <Harness reactor={reactor}>
        <ReactorDisplay display={card} context={{ who: 'Grace' }} loading="…" />
      </Harness>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toBe('Card for Grace');
  });
});

describe('useUiChannel', () => {
  it('keeps its scope and hands window ops over', () => {
    const windows: string[] = [];
    let emit: ((ops: UiOp | readonly UiOp[]) => void) | undefined;
    function View() {
      const channel = useUiChannel({ scope: 'mine', onWindow: (op) => windows.push(op.body.name) });
      emit = channel.emit;
      return <>{channel.model.order.join(',')}</>;
    }
    const reactor = buildReactorFromPlugins([definePlugin({ name: '@tests/none' })]);
    mount(
      <Harness reactor={reactor}>
        <View />
      </Harness>,
    );
    act(() =>
      emit?.([
        { v: 1, op: 'show', scope: 'mine', body: card },
        { v: 1, op: 'show', scope: 'theirs', body: { ...card, id: 'other' } },
        { v: 1, op: 'window', scope: 'mine', body: { name: 'focus' } },
      ]),
    );
    expect(container.textContent).toBe('c');
    expect(windows).toEqual(['focus']);
  });
});
