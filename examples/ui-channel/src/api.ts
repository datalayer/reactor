/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/** The example server's routes (`ui_channel_example.server`). */

import { isUiOp, type UiAction, type UiOp } from '../../../src/ui';

export const SERVER = 'http://localhost:8791';
export const SESSION = 'demo';

async function json<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${body.error ?? ''}: ${body.detail ?? JSON.stringify(body)}`);
  }
  return body as T;
}

/** The ops from the `after`-th on, and where the next read starts. */
export async function readOps(after: number): Promise<{ ops: UiOp[]; next: number }> {
  const page = await json<{ ops: unknown[]; next: number }>(
    await fetch(`${SERVER}/sessions/${SESSION}/ops?after=${after}`),
  );
  // What arrives over the network is checked before the reducer sees it.
  const ops = page.ops.filter(isUiOp);
  if (ops.length !== page.ops.length) {
    throw new Error('The server sent something that is not a reactor.ui op');
  }
  return { ops, next: page.next };
}

export async function requestApproval(request: { title: string; amount_eur: number; requester: string; reviewer_note: string }) {
  return json(
    await fetch(`${SERVER}/sessions/${SESSION}/approvals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
}

/** A press, as the person `principal`. */
export async function sendAction(principal: string, action: UiAction): Promise<unknown> {
  return json(
    await fetch(`${SERVER}/sessions/${SESSION}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Principal': principal },
      body: JSON.stringify(action),
    }),
  );
}

/** What a model is told about the session. */
export async function readModelView(): Promise<unknown> {
  return json(await fetch(`${SERVER}/sessions/${SESSION}/model`));
}
