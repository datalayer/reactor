// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildReactorFromExtensions, defineExtension } from '../../index';
import { registerReactor, useReactor, useReactorStore } from '../reactor';

describe('useReactor', () => {
  beforeEach(() => {
    registerReactor(null);
  });

  it('registers on mount and unregisters on unmount for the same instance', () => {
    const Extension = defineExtension({
      name: '@tests/reactor',
      build() {
        return {};
      },
    });

    const reactor = buildReactorFromExtensions([Extension]);

    function Harness() {
      useReactor(reactor, { autoStart: false });
      return null;
    }

    const container = document.createElement('div');
    const root = createRoot(container);

    act(() => {
      root.render(<Harness />);
    });

    expect(useReactorStore.getState().reactor).toBe(reactor);

    act(() => {
      root.unmount();
    });

    expect(useReactorStore.getState().reactor).toBeNull();
  });
});
