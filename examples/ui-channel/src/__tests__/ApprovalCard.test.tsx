/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildReactorFromPlugins, type ReactorPlatform } from '../../../../src';
import { registerReactor, useReactor } from '../../../../src/react';
import { ReactorDisplay } from '../../../../src/react/ui';
import type { Display, UiAct } from '../../../../src/ui';
import recorded from '../../fixtures/demo-ops.json';
import { ApprovalsPlugin } from '../approvalPlugin';

/** The train approval as the recorded session showed it, offer and token included. */
const train = (recorded as { op: string; id: string | null; body: unknown }[]).find(
  (op) => op.op === 'show' && op.id === 'train',
)!.body as Display;

let root: Root | null = null;
let container: HTMLDivElement;

function Harness({ reactor, children }: { reactor: ReactorPlatform; children: React.ReactNode }) {
  useReactor(reactor, { autoStart: true });
  return <>{children}</>;
}

async function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(node);
  });
}

/** The renderer is lazy: wait for its import to settle and the card to draw. */
async function card(id: string): Promise<Element> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const found = container.querySelector(`[data-approval="${id}"]`);
    if (found) {
      return found;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error(`No card for ${id}`);
}

afterEach(() => {
  const mounted = root;
  if (mounted) {
    act(() => mounted.unmount());
    root = null;
  }
  container?.remove();
  registerReactor(null);
});

describe('ApprovalCard through ReactorDisplay', () => {
  it('draws the approval and presses the offered decision', async () => {
    const act_ = vi.fn<UiAct>(async () => ({ status: 'approved' }));
    await mount(
      <Harness reactor={buildReactorFromPlugins([ApprovalsPlugin])}>
        <ReactorDisplay display={train} act={act_} />
      </Harness>,
    );
    expect((await card('train')).textContent).toContain('Train to Ghent');
    const approve = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Approve')!;
    await act(async () => {
      approve.click();
    });
    expect(act_).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'approvals.decide', payload: { approve: true, comment: '' } }),
    );
  });

  it('draws the text when the plugin is off', async () => {
    const reactor = buildReactorFromPlugins([ApprovalsPlugin]);
    await mount(
      <Harness reactor={reactor}>
        <ReactorDisplay display={train} />
      </Harness>,
    );
    await card('train');
    await act(async () => {
      reactor.disable('@example/approvals');
    });
    expect(container.textContent).toBe('Train to Ghent: 64.50 EUR for grace (pending)');
  });
});
