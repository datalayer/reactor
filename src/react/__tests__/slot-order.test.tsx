/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

// @vitest-environment jsdom

/**
 * A slot renders its components by `order`, and by plugin order otherwise.
 */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildReactorFromPlugins, definePlugin } from '../../index';
import { ReactorSlot, registerReactor } from '../reactor';

const panel = (name: string, label: string, order?: number) =>
  definePlugin({
    name,
    build: () => ({
      components: [
        { id: label, slot: 'side', order, Component: () => <p>{label}</p> },
      ],
    }),
  });

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  registerReactor(null, () => false);
});

describe('ReactorSlot ordering', () => {
  it('sorts by order, lower first, and keeps plugin order for ties and the unordered', async () => {
    const reactor = buildReactorFromPlugins([
      panel('@t/last', 'last', 900),
      panel('@t/plain-a', 'plain-a'),
      panel('@t/first', 'first', 10),
      panel('@t/plain-b', 'plain-b'),
      panel('@t/also-first', 'also-first', 10),
    ]);
    reactor.start();
    await reactor.whenReady();
    registerReactor(reactor, () => false);

    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<ReactorSlot slot="side" />);
    });

    const labels = Array.from(host.querySelectorAll('p')).map((p) => p.textContent);
    expect(labels).toEqual(['plain-a', 'plain-b', 'first', 'also-first', 'last']);
  });
});
