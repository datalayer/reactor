/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildReactorFromPlugins, definePlugin } from '../../index';
import { registerReactor, useReactor, useReactorStore } from '../reactor';

describe('useReactor', () => {
  beforeEach(() => {
    registerReactor(null);
  });

  it('registers on mount and unregisters on unmount for the same instance', () => {
    const Extension = definePlugin({
      name: '@tests/reactor',
      build() {
        return {};
      },
    });

    const reactor = buildReactorFromPlugins([Extension]);

    function Harness() {
      useReactor(reactor, { autoStart: false });
      return null;
    }

    const container = document.createElement('div');
    let root: Root | null = null;

    try {
      root = createRoot(container);
      const mountedRoot = root;

      act(() => {
        mountedRoot.render(<Harness />);
      });

      expect(useReactorStore.getState().reactor).toBe(reactor);
    } finally {
      const mountedRoot = root;
      if (mountedRoot) {
        act(() => {
          mountedRoot.unmount();
        });
      }
    }

    expect(useReactorStore.getState().reactor).toBeNull();
  });
});
