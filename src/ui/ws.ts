/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The ui channel over one WebSocket, the page's end (REACTOR_UI RU-W): the
 * twin of `reactor.ui.ws`.
 *
 * One `UiSocket` per conversation (a scope). It says `hello` first — the
 * credential, never in the URL; the scope; the last op it applied — then
 * hands each op to `onOp` in order, once: an op it already applied (a
 * resume) is skipped, a gap makes it reconnect from its last op. Presses go
 * up with `act` (with an idempotency id, so a press sent again after a
 * reconnect is run once), page state with `state`; each is answered by the
 * result of the same `ref`. Both sides ping; a socket that hears nothing for
 * `timeoutMs` reconnects.
 *
 * Fails fast: a frame from the host that is not the schema's closes the
 * connection with the reason (`4400`) and the socket stops; a refusal of the
 * hello (`4400`, `4401`, `4403`) or a resume the host cannot serve (`4410`)
 * stops it too, and says so on `onStatus`. Anything else — a dropped
 * connection, a slow page closed by the host (`4429`), a timeout — reconnects
 * with backoff, from the last op applied.
 *
 * @module ui/ws
 */

import {
  isDownFrame,
  UI_WIRE_VERSION,
  type ActionFrame,
  type DownFrame,
  type PatchOperation,
  type StateFrame,
  type UiAction,
  type UiOp,
  type UpFrame,
} from './wire';

/** The WebSocket subprotocol the socket asks for. */
export const UI_WS_PROTOCOL = 'reactor.ui.v1';

/** The close codes of `reactor.ui.ws`. */
export const UI_WS_CLOSE = {
  refused: 4400,
  unauthorized: 4401,
  forbidden: 4403,
  timeout: 4408,
  gone: 4410,
  slow: 4429,
} as const;

/** Where the socket is. `refused` and `gone` are final, as is `closed`. */
export type UiSocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'refused' | 'gone';

/** What a press or a state frame came to: the host's `result` frame. */
export type UiSocketResult = { ok: boolean; status: number; detail?: string | null; value?: unknown };

/** The part of a browser `WebSocket` the socket uses. */
export type WebSocketLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type UiSocketOptions = {
  /** The endpoint, `ws://` or `wss://`. */
  url: string;
  /** The conversation. */
  scope: string;
  /** The credential the hello carries, read at each (re)connection. */
  token: () => string | Promise<string>;
  /**
   * Each op, in order, once. `history` is true for an op the host sent
   * before this page first connected (a fresh hello replays what it keeps):
   * a page draws it again, and does not act on it as news — a `window` op
   * of the past is not raised again.
   */
  onOp: (op: UiOp, seq: number, history: boolean) => void;
  /** Where the socket is, and why when it stopped. */
  onStatus?: (status: UiSocketStatus, reason?: string) => void;
  /** Opens a connection; a browser `WebSocket` by default. */
  open?: (url: string, protocols: string[]) => WebSocketLike;
  /** How often to ping when quiet. */
  heartbeatMs?: number;
  /** How long to wait hearing nothing before reconnecting. */
  timeoutMs?: number;
  /** The waits before each reconnection; the last repeats. */
  backoffMs?: readonly number[];
  /** How many presses may wait for their result. */
  maxPending?: number;
  /** The last op already applied, when the page kept one. */
  since?: number;
  /** A new id, for refs and idempotency ids. */
  newId?: () => string;
};

/** The hello refused, a frame refused, or a resume the host cannot serve. */
export class UiSocketStopped extends Error {
  constructor(
    readonly status: UiSocketStatus,
    readonly reason: string,
  ) {
    super(`reactor.ui socket ${status}: ${reason}`);
  }
}

type Pending = {
  frame: ActionFrame | StateFrame;
  resolve: (result: UiSocketResult) => void;
  reject: (error: Error) => void;
};

const FINAL_CLOSES: Record<number, UiSocketStatus> = {
  [UI_WS_CLOSE.refused]: 'refused',
  [UI_WS_CLOSE.unauthorized]: 'refused',
  [UI_WS_CLOSE.forbidden]: 'refused',
  [UI_WS_CLOSE.gone]: 'gone',
};

function randomId(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class UiSocket {
  /** The last op applied. */
  lastSeq: number;
  /** Where the socket is. */
  status: UiSocketStatus = 'connecting';

  private ws: WebSocketLike | null = null;
  private welcomed = false;
  private historyUpTo = 0;
  private resumable: boolean;
  private stopped = false;
  private attempt = 0;
  private heard = 0;
  private beat: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly options: Required<Omit<UiSocketOptions, 'onStatus' | 'since' | 'open'>> &
    Pick<UiSocketOptions, 'onStatus' | 'open'>;

  constructor(options: UiSocketOptions) {
    this.options = {
      heartbeatMs: 20_000,
      timeoutMs: 60_000,
      backoffMs: [250, 1_000, 2_000, 5_000],
      maxPending: 64,
      newId: randomId,
      ...options,
    };
    this.lastSeq = options.since ?? 0;
    this.resumable = options.since !== undefined;
  }

  /** Open the connection. */
  connect(): void {
    if (this.stopped || this.ws) {
      return;
    }
    this.setStatus(this.attempt === 0 && !this.resumable ? 'connecting' : 'reconnecting');
    const open =
      this.options.open ??
      ((url: string, protocols: string[]) =>
        new (globalThis as unknown as { WebSocket: new (u: string, p: string[]) => WebSocketLike }).WebSocket(
          url,
          protocols,
        ));
    const ws = open(this.options.url, [UI_WS_PROTOCOL]);
    this.ws = ws;
    this.welcomed = false;
    ws.onopen = () => void this.hello(ws);
    ws.onmessage = (event) => this.receive(ws, event.data);
    ws.onclose = (event) => this.closed(ws, event.code, event.reason);
    ws.onerror = () => undefined;
  }

  /**
   * Press something a display offered. Resolves with the host's result —
   * refusals included (`ok: false`, the status); rejects only when the
   * socket stops before it is answered. Sent again after a reconnect, with
   * the same idempotency id: run once.
   */
  act(action: Omit<UiAction, 'idempotency_id'> & { idempotency_id?: string | null }): Promise<UiSocketResult> {
    const press: UiAction = { ...action, idempotency_id: action.idempotency_id ?? this.options.newId() };
    return this.request({ t: 'action', ref: this.options.newId(), action: press });
  }

  /** Patch the scope's shared state from the page. */
  state(body: PatchOperation[]): Promise<UiSocketResult> {
    return this.request({ t: 'state', ref: this.options.newId(), body });
  }

  /** Close for good. */
  close(): void {
    this.stop('closed', 'closed by the page', 1000);
  }

  private request(frame: ActionFrame | StateFrame): Promise<UiSocketResult> {
    if (this.stopped) {
      return Promise.reject(new UiSocketStopped(this.status, 'the socket is stopped'));
    }
    if (this.pending.size >= this.options.maxPending) {
      return Promise.reject(new Error(`${this.pending.size} presses are waiting for their result`));
    }
    return new Promise((resolve, reject) => {
      this.pending.set(frame.ref, { frame, resolve, reject });
      if (this.welcomed) {
        this.send(frame);
      }
    });
  }

  private async hello(ws: WebSocketLike): Promise<void> {
    let token: string;
    try {
      token = await this.options.token();
    } catch (error) {
      this.stop('refused', `no credential: ${String(error)}`, 1000);
      return;
    }
    if (ws !== this.ws) {
      return;
    }
    this.heard = Date.now();
    this.send({
      t: 'hello',
      v: UI_WIRE_VERSION,
      token,
      scope: this.options.scope,
      since: this.resumable ? this.lastSeq : null,
    });
    this.beat = setInterval(() => this.heartbeat(ws), this.options.heartbeatMs);
  }

  private heartbeat(ws: WebSocketLike): void {
    if (ws !== this.ws) {
      return;
    }
    if (Date.now() - this.heard > this.options.timeoutMs) {
      ws.close(UI_WS_CLOSE.timeout, 'nothing heard');
      this.closed(ws, UI_WS_CLOSE.timeout, 'nothing heard');
      return;
    }
    this.send({ t: 'ping' });
  }

  private receive(ws: WebSocketLike, data: unknown): void {
    if (ws !== this.ws) {
      return;
    }
    let frame: unknown;
    try {
      frame = typeof data === 'string' ? JSON.parse(data) : undefined;
    } catch {
      frame = undefined;
    }
    if (!isDownFrame(frame)) {
      this.stop('refused', 'the host sent a frame that is not the schema’s', UI_WS_CLOSE.refused);
      return;
    }
    this.heard = Date.now();
    this.handle(ws, frame);
  }

  private handle(ws: WebSocketLike, frame: DownFrame): void {
    switch (frame.t) {
      case 'welcome':
        if (frame.scope !== this.options.scope) {
          this.stop('refused', `welcomed to ${frame.scope}, not ${this.options.scope}`, UI_WS_CLOSE.refused);
          return;
        }
        if (this.resumable && frame.seq < this.lastSeq) {
          // The host has fewer ops than the page applied: it lost them.
          this.stop('gone', `the host is at op ${frame.seq}, the page at ${this.lastSeq}`, 1000);
          return;
        }
        if (!this.resumable) {
          // A fresh hello: what the host replays now is the past.
          this.historyUpTo = frame.seq;
        }
        this.welcomed = true;
        this.attempt = 0;
        this.setStatus('open');
        for (const waiting of this.pending.values()) {
          this.send(waiting.frame);
        }
        return;
      case 'op':
        if (!this.welcomed) {
          this.stop('refused', 'an op before the welcome', UI_WS_CLOSE.refused);
          return;
        }
        if (frame.seq <= this.lastSeq) {
          return;
        }
        if (frame.seq !== this.lastSeq + 1) {
          // A gap: resume from the last op applied.
          ws.close(1000, `op ${frame.seq} after ${this.lastSeq}`);
          this.closed(ws, 1000, 'a gap');
          return;
        }
        this.lastSeq = frame.seq;
        this.resumable = true;
        this.options.onOp(frame.op, frame.seq, frame.seq <= this.historyUpTo);
        return;
      case 'result': {
        const waiting = this.pending.get(frame.ref);
        if (waiting) {
          this.pending.delete(frame.ref);
          waiting.resolve({ ok: frame.ok, status: frame.status, detail: frame.detail, value: frame.value });
        }
        return;
      }
      case 'ping':
        this.send({ t: 'pong' });
        return;
      case 'pong':
        return;
    }
  }

  private closed(ws: WebSocketLike, code: number, reason: string): void {
    if (ws !== this.ws) {
      return;
    }
    this.ws = null;
    this.welcomed = false;
    this.clearBeat();
    if (this.stopped) {
      return;
    }
    const final = FINAL_CLOSES[code];
    if (final) {
      this.stop(final, reason || `closed with ${code}`);
      return;
    }
    // A resume, from the last op applied.
    this.resumable = this.resumable || this.lastSeq > 0;
    const waits = this.options.backoffMs;
    const wait = waits[Math.min(this.attempt, waits.length - 1)] ?? 1_000;
    this.attempt += 1;
    this.setStatus('reconnecting', reason);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, wait);
  }

  private stop(status: UiSocketStatus, reason: string, code?: number): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.clearBeat();
    if (this.retry) {
      clearTimeout(this.retry);
      this.retry = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws && code !== undefined) {
      ws.close(code, reason.slice(0, 120));
    }
    for (const waiting of this.pending.values()) {
      waiting.reject(new UiSocketStopped(status, reason));
    }
    this.pending.clear();
    this.setStatus(status, reason);
  }

  private send(frame: UpFrame): void {
    this.ws?.send(JSON.stringify(frame));
  }

  private clearBeat(): void {
    if (this.beat) {
      clearInterval(this.beat);
      this.beat = null;
    }
  }

  private setStatus(status: UiSocketStatus, reason?: string): void {
    this.status = status;
    this.options.onStatus?.(status, reason);
  }
}
