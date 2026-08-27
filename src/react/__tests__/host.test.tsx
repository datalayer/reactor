/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildReactorFromExtensions,
  contribution,
  defineExtension,
  defineExtensionPoint,
  type PhaseContext,
  type ReactorPlatform,
} from '../../index';
import { registerReactor, useReactor } from '../reactor';
import { ReactorViewHost, useContributions } from '../host';

type View = {
  title: string;
  Component?: React.ComponentType<Record<string, unknown>>;
  load?: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>;
};

const ViewPoint = defineExtensionPoint<View>('tests.host.view');

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

function Harness({
  reactor,
  children,
}: {
  reactor: ReactorPlatform;
  children: React.ReactNode;
}) {
  useReactor(reactor, { autoStart: true });
  return <>{children}</>;
}

beforeEach(() => {
  registerReactor(null);
});

afterEach(() => {
  const mounted = root;
  if (mounted) {
    act(() => {
      mounted.unmount();
    });
    root = null;
  }
  container?.remove();
});

describe('useContributions', () => {
  it('re-renders when a contribution arrives after start', () => {
    let contribute: PhaseContext<any, any, any>['contribute'] | undefined;
    const Extension = defineExtension({
      name: '@tests/late-view',
      register(ctx) {
        contribute = ctx.contribute;
      },
    });
    const reactor = buildReactorFromExtensions([Extension]);

    function Titles() {
      const views = useContributions(ViewPoint);
      return <span data-testid="titles">{views.map((v) => v.value.title).join(',')}</span>;
    }

    mount(
      <Harness reactor={reactor}>
        <Titles />
      </Harness>,
    );

    expect(container.querySelector('[data-testid="titles"]')?.textContent).toBe('');

    act(() => {
      contribute?.(ViewPoint, { title: 'Notebook' }, { id: 'notebook' });
    });

    expect(container.querySelector('[data-testid="titles"]')?.textContent).toBe(
      'Notebook',
    );
  });
});

describe('ReactorViewHost', () => {
  it('renders the active contribution and passes props through', () => {
    const Extension = defineExtension({
      name: '@tests/eager',
      contributes: [
        contribution(
          ViewPoint,
          {
            title: 'Eager',
            Component: (props: Record<string, unknown>) => (
              <span data-testid="view">eager:{String(props.label)}</span>
            ),
          },
          { id: 'eager' },
        ),
      ],
    });
    const reactor = buildReactorFromExtensions([Extension]);

    mount(
      <Harness reactor={reactor}>
        <ReactorViewHost point={ViewPoint} active="eager" props={{ label: 'hello' }} />
      </Harness>,
    );

    expect(container.querySelector('[data-testid="view"]')?.textContent).toBe(
      'eager:hello',
    );
  });

  it('renders `empty` when the active id matches nothing', () => {
    const reactor = buildReactorFromExtensions([defineExtension({ name: '@tests/bare' })]);

    mount(
      <Harness reactor={reactor}>
        <ReactorViewHost
          point={ViewPoint}
          active="missing"
          empty={<span data-testid="empty">nothing here</span>}
        />
      </Harness>,
    );

    expect(container.querySelector('[data-testid="empty"]')?.textContent).toBe(
      'nothing here',
    );
  });

  it('loads a lazy view, showing the fallback until it resolves', async () => {
    const Extension = defineExtension({
      name: '@tests/lazy',
      contributes: [
        contribution(
          ViewPoint,
          {
            title: 'Lazy',
            load: () =>
              Promise.resolve({
                default: () => <span data-testid="view">lazy loaded</span>,
              }),
          },
          { id: 'lazy' },
        ),
      ],
    });
    const reactor = buildReactorFromExtensions([Extension]);

    mount(
      <Harness reactor={reactor}>
        <ReactorViewHost
          point={ViewPoint}
          active="lazy"
          fallback={<span data-testid="loading">loading</span>}
        />
      </Harness>,
    );

    expect(container.querySelector('[data-testid="loading"]')).not.toBeNull();

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="view"]')?.textContent).toBe(
      'lazy loaded',
    );
  });

  it('keeps the host alive when a lazy view fails to load', async () => {
    // React logs the boundary-caught error; the test asserts recovery, not silence.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Extension = defineExtension({
      name: '@tests/broken',
      contributes: [
        contribution(
          ViewPoint,
          {
            title: 'Broken',
            load: () => Promise.reject(new Error('module missing')),
          },
          { id: 'broken' },
        ),
      ],
    });
    const reactor = buildReactorFromExtensions([Extension]);

    mount(
      <Harness reactor={reactor}>
        <div data-testid="shell">
          <ReactorViewHost
            point={ViewPoint}
            active="broken"
            errorFallback={(error) => <span data-testid="error">{error.message}</span>}
          />
        </div>
      </Harness>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe(
      'module missing',
    );
    // The shell around the broken plugin is still standing.
    expect(container.querySelector('[data-testid="shell"]')).not.toBeNull();
    consoleError.mockRestore();
  });

  it('drops the view when its extension is disabled', () => {
    const Extension = defineExtension({
      name: '@tests/toggleable',
      contributes: [
        contribution(
          ViewPoint,
          {
            title: 'Toggleable',
            Component: () => <span data-testid="view">on screen</span>,
          },
          { id: 'toggleable' },
        ),
      ],
    });
    const reactor = buildReactorFromExtensions([Extension]);

    mount(
      <Harness reactor={reactor}>
        <ReactorViewHost
          point={ViewPoint}
          active="toggleable"
          empty={<span data-testid="empty">gone</span>}
        />
      </Harness>,
    );

    expect(container.querySelector('[data-testid="view"]')).not.toBeNull();

    act(() => {
      reactor.disable('@tests/toggleable');
    });

    expect(container.querySelector('[data-testid="view"]')).toBeNull();
    expect(container.querySelector('[data-testid="empty"]')?.textContent).toBe('gone');
  });
});
