/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The page's end of the ui socket (REACTOR_UI RU-W): the committed example
 * the Python host wrote replayed against it, then ordering, resume after a
 * gap or a drop, refusal, heartbeats, and two tabs on one conversation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyUiOps, emptyUiModel } from '../reducer';
import type { UiOp } from '../wire';
import { UI_WS_CLOSE, UiSocket, UiSocketStopped, type UiSocketOptions, type WebSocketLike } from '../ws';

type Frame = Record<string, unknown>;

class FakeWs implements WebSocketLike {
  sent: Frame[] = [];
  closedWith: [number | undefined, string | undefined] | null = null;
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  onSend: ((frame: Frame) => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}

  send(data: string): void {
    const frame = JSON.parse(data) as Frame;
    this.sent.push(frame);
    this.onSend?.(frame);
  }
  close(code?: number, reason?: string): void {
    this.closedWith = [code, reason];
  }
  open(): void {
    this.onopen?.({});
  }
  down(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }
  drop(code = 1006, reason = ''): void {
    this.onclose?.({ code, reason });
  }
}

/** Let the hello's credential resolve. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(options: Partial<UiSocketOptions> = {}) {
  const sockets: FakeWs[] = [];
  const ops: [UiOp, number][] = [];
  const history: number[] = [];
  const statuses: string[] = [];
  let next = 0;
  const socket = new UiSocket({
    url: 'wss://host/ui',
    scope: 's1',
    token: () => 'ada',
    onOp: (op, seq, past) => {
      ops.push([op, seq]);
      if (past) history.push(seq);
    },
    onStatus: (status) => statuses.push(status),
    open: (url, protocols) => {
      const ws = new FakeWs(url, protocols);
      sockets.push(ws);
      return ws;
    },
    backoffMs: [0],
    newId: () => `id-${++next}`,
    ...options,
  });
  return { socket, sockets, ops, history, statuses, last: () => sockets[sockets.length - 1] };
}

const op = (seq: number, id = `d${seq}`): Frame => ({
  t: 'op',
  seq,
  op: { v: 1, op: 'show', scope: 's1', id, body: { type: 'application/x+json', id, text: id } },
});

async function opened(h: ReturnType<typeof harness>, seq = 0): Promise<FakeWs> {
  h.socket.connect();
  const ws = h.last();
  ws.open();
  await settle();
  ws.down({ t: 'welcome', v: 1, scope: 's1', seq });
  return ws;
}

describe('the committed example, written by the Python host', () => {
  it('is replayed exactly: what the page sends, and what it applies', async () => {
    const fs: string = 'node:fs';
    const { readFileSync } = await import(/* @vite-ignore */ fs);
    const example = JSON.parse(
      readFileSync(new URL('../../../schema/reactor-ui.v1.ws-examples.json', import.meta.url), 'utf8'),
    ) as { connections: ({ up: Frame } | { down: Frame })[][] };
    const h = harness();
    let result: unknown;
    for (const [index, connection] of example.connections.entries()) {
      if (index === 0) {
        h.socket.connect();
      } else {
        h.sockets[index - 1].drop();
        await settle();
      }
      const ws = h.sockets[index];
      expect(ws.protocols).toEqual(['reactor.ui.v1']);
      // Deliver the down frames in order as each up frame arrives.
      let cursor = 0;
      const deliver = () => {
        while (cursor < connection.length && 'down' in connection[cursor]) {
          ws.down((connection[cursor] as { down: Frame }).down);
          cursor += 1;
        }
      };
      ws.onSend = (frame) => {
        const step = connection[cursor] as { up: Frame };
        expect(frame).toEqual(step.up);
        cursor += 1;
        queueMicrotask(deliver);
      };
      ws.open();
      await settle();
      if (index === 0) {
        result = await h.socket.act({ action: 'close', display_id: 'card-1', token: 't0k', payload: {} });
      }
      await settle();
      expect(cursor).toBe(connection.length);
    }
    expect(result).toEqual({ ok: true, status: 200, detail: null, value: { closed: 'card-1' } });
    expect(h.ops.map(([, seq]) => seq)).toEqual([1, 2, 3, 4]);
    // Ops 1 and 2 were sent before the page first connected: its history.
    // The one emitted while it pressed, and the one missed while away, are news.
    expect(h.history).toEqual([1, 2]);
    const model = applyUiOps(
      emptyUiModel(),
      h.ops.map(([one]) => one),
    );
    expect(model.meta).toEqual({ title: 'Q3' });
    expect(model.displays).toEqual({});
    expect(h.socket.lastSeq).toBe(4);
  });
});

describe('the ui socket', () => {
  it('says hello first, with its credential, never in the URL', async () => {
    const h = harness({ token: async () => 'secret' });
    const ws = await opened(h);
    expect(ws.url).toBe('wss://host/ui');
    expect(ws.sent[0]).toEqual({ t: 'hello', v: 1, token: 'secret', scope: 's1', since: null });
    expect(h.statuses).toEqual(['connecting', 'open']);
  });

  it('applies ops in order, once; resumes after a gap from its last op', async () => {
    const h = harness();
    const ws = await opened(h);
    ws.down(op(1));
    ws.down(op(1));
    ws.down(op(2));
    ws.down(op(4));
    expect(h.ops.map(([, seq]) => seq)).toEqual([1, 2]);
    expect(ws.closedWith?.[0]).toBe(1000);
    await settle();
    const again = h.last();
    expect(again).not.toBe(ws);
    again.open();
    await settle();
    expect(again.sent[0]).toMatchObject({ t: 'hello', since: 2 });
    again.down({ t: 'welcome', scope: 's1', seq: 4 });
    again.down(op(3));
    again.down(op(4));
    expect(h.ops.map(([, seq]) => seq)).toEqual([1, 2, 3, 4]);
  });

  it('reconnects after a drop or a slow close, and sends again what waits for its result, once', async () => {
    const h = harness();
    const ws = await opened(h);
    ws.down(op(1));
    const pressed = h.socket.act({ action: 'go', display_id: 'd1', token: 't' });
    expect(ws.sent[1]).toEqual({
      t: 'action',
      ref: 'id-2',
      action: { action: 'go', display_id: 'd1', token: 't', idempotency_id: 'id-1' },
    });
    ws.drop(UI_WS_CLOSE.slow, 'too slow');
    expect(h.statuses).toContain('reconnecting');
    await settle();
    const again = h.last();
    again.open();
    await settle();
    expect(again.sent[0]).toMatchObject({ t: 'hello', since: 1 });
    again.down({ t: 'welcome', scope: 's1', seq: 1 });
    // The same ref, the same idempotency id: the host runs it once.
    expect(again.sent[1]).toEqual(ws.sent[1]);
    again.down({ t: 'result', ref: 'id-2', ok: false, status: 403, detail: 'not offered' });
    await expect(pressed).resolves.toEqual({ ok: false, status: 403, detail: 'not offered', value: undefined });
  });

  it('refuses a frame that is not the schema’s, closing with the reason, and stops', async () => {
    for (const bad of ['not json', { t: 'op', seq: 1 }, { t: 'welcome', scope: 's1', seq: 0, extra: 1 }, { t: 'shout' }]) {
      const h = harness();
      const ws = await opened(h);
      const pressed = h.socket.act({ action: 'go', display_id: 'd', token: 't' });
      ws.down(bad);
      expect(ws.closedWith?.[0]).toBe(UI_WS_CLOSE.refused);
      expect(h.socket.status).toBe('refused');
      await expect(pressed).rejects.toBeInstanceOf(UiSocketStopped);
      await settle();
      expect(h.sockets).toHaveLength(1);
    }
  });

  it('stops on a refused hello or a resume the host cannot serve', async () => {
    for (const [code, status] of [
      [UI_WS_CLOSE.unauthorized, 'refused'],
      [UI_WS_CLOSE.forbidden, 'refused'],
      [UI_WS_CLOSE.refused, 'refused'],
      [UI_WS_CLOSE.gone, 'gone'],
    ] as const) {
      const h = harness();
      const ws = await opened(h);
      ws.drop(code, 'no');
      await settle();
      expect(h.socket.status).toBe(status);
      expect(h.sockets).toHaveLength(1);
    }
    // Welcomed by a host that has fewer ops than the page applied: gone.
    const h = harness({ since: 5 });
    h.socket.connect();
    h.last().open();
    await settle();
    expect(h.last().sent[0]).toMatchObject({ since: 5 });
    h.last().down({ t: 'welcome', scope: 's1', seq: 2 });
    expect(h.socket.status).toBe('gone');
  });

  it('answers pings, and closes for good when the page does', async () => {
    const h = harness();
    const ws = await opened(h);
    ws.down({ t: 'ping' });
    expect(ws.sent[ws.sent.length - 1]).toEqual({ t: 'pong' });
    h.socket.close();
    expect(ws.closedWith?.[0]).toBe(1000);
    expect(h.socket.status).toBe('closed');
    await expect(h.socket.act({ action: 'go', display_id: 'd', token: 't' })).rejects.toBeInstanceOf(
      UiSocketStopped,
    );
  });
});

describe('heartbeats', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('pings when quiet and reconnects when nothing is heard', async () => {
    const h = harness({ heartbeatMs: 1_000, timeoutMs: 2_500 });
    h.socket.connect();
    const ws = h.last();
    ws.open();
    await vi.advanceTimersByTimeAsync(0);
    ws.down({ t: 'welcome', scope: 's1', seq: 0 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ws.sent[ws.sent.length - 1]).toEqual({ t: 'ping' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ws.closedWith?.[0]).toBe(UI_WS_CLOSE.timeout);
    await vi.advanceTimersByTimeAsync(10);
    expect(h.sockets).toHaveLength(2);
  });
});

describe('two tabs on one conversation', () => {
  it('each applies every op; each press is answered on its own tab', async () => {
    const tabs = [harness(), harness()];
    const sockets = await Promise.all(tabs.map((tab) => opened(tab)));
    // The host: every op to both, a result to the tab that pressed.
    let seq = 0;
    for (const [index, ws] of sockets.entries()) {
      ws.onSend = (frame) => {
        if (frame.t !== 'action') return;
        seq += 1;
        for (const each of sockets) each.down(op(seq, `pressed-${index}`));
        ws.down({ t: 'result', ref: frame.ref, ok: true, status: 200 });
      };
    }
    const first = tabs[0].socket.act({ action: 'go', display_id: 'd', token: 't' });
    const second = tabs[1].socket.act({ action: 'go', display_id: 'd', token: 't' });
    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(second).resolves.toMatchObject({ ok: true });
    for (const tab of tabs) {
      expect(tab.ops.map(([one, at]) => [one.id, at])).toEqual([
        ['pressed-0', 1],
        ['pressed-1', 2],
      ]);
    }
  });
});
