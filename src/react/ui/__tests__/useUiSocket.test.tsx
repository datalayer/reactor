/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocketLike } from '../../../ui/ws';
import { useUiSocket, type UiSocketState } from '../useUiSocket';

class FakeWs implements WebSocketLike {
  sent: Record<string, unknown>[] = [];
  closedWith: number | undefined;
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number): void {
    this.closedWith = code;
  }
  down(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('useUiSocket', () => {
  it('reduces the ops of its conversation, sends presses up, and closes on unmount', async () => {
    const sockets: FakeWs[] = [];
    const windows: string[] = [];
    let seen: UiSocketState | null = null;
    function Page() {
      seen = useUiSocket({
        url: 'wss://host/ui',
        scope: 's1',
        token: () => 'ada',
        open: () => {
          const ws = new FakeWs();
          sockets.push(ws);
          return ws;
        },
        onWindow: (op) => windows.push(op.body.name),
      });
      return <span>{Object.keys(seen.model.displays).join(',')}</span>;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<Page />));
    const ws = sockets[0];
    await act(async () => {
      ws.onopen?.({});
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(ws.sent[0]).toMatchObject({ t: 'hello', token: 'ada', scope: 's1' });
    act(() => {
      ws.down({ t: 'welcome', scope: 's1', seq: 0 });
      ws.down({
        t: 'op',
        seq: 1,
        op: { v: 1, op: 'show', scope: 's1', id: 'card', body: { type: 'application/x+json', id: 'card', text: 'A' } },
      });
      ws.down({ t: 'op', seq: 2, op: { v: 1, op: 'window', scope: 's1', body: { name: 'focus' } } });
    });
    expect(seen!.status).toBe('open');
    expect(container.textContent).toBe('card');
    expect(windows).toEqual(['focus']);
    let answered: unknown;
    await act(async () => {
      const pressed = seen!.act({ action: 'go', display_id: 'card', token: 't' });
      const sent = ws.sent[ws.sent.length - 1] as { ref: string };
      ws.down({ t: 'result', ref: sent.ref, ok: true, status: 200, value: 1 });
      answered = await pressed;
    });
    expect(answered).toMatchObject({ ok: true, value: 1 });
    act(() => root?.unmount());
    root = null;
    expect(ws.closedWith).toBe(1000);
  });
});
