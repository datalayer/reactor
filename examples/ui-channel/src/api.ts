/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/** The example server's routes and socket (`ui_channel_example.server`). */

export const SERVER = 'http://localhost:8791';

/** The ui channel's WebSocket (`reactor.ui.ws`). */
export const SOCKET = 'ws://localhost:8791/ui';
export const SESSION = 'demo';

async function json<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${body.error ?? ''}: ${body.detail ?? JSON.stringify(body)}`);
  }
  return body as T;
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

/** What a model is told about the session. */
export async function readModelView(): Promise<unknown> {
  return json(await fetch(`${SERVER}/sessions/${SESSION}/model`));
}
