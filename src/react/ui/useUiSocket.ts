/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The ui channel of one conversation over its WebSocket, in React
 * (REACTOR_UI RU-W): the ops reduced into a `UiModel` as they arrive, the
 * socket's status, and `act` / `state` to send presses and page state up.
 *
 * One socket per `url` and `scope`: it opens on mount, reconnects from its
 * last op on its own, and closes on unmount or when either changes. The
 * credential is read through `token` at each (re)connection.
 *
 * @module react/ui/useUiSocket
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { applyUiOp, emptyUiModel, type UiModel } from '../../ui/reducer';
import type { PatchOperation, UiAction, UiOp, WindowOp } from '../../ui/wire';
import { UiSocket, type UiSocketOptions, type UiSocketResult, type UiSocketStatus } from '../../ui/ws';

export type UseUiSocketOptions = Pick<
  UiSocketOptions,
  'url' | 'scope' | 'token' | 'open' | 'heartbeatMs' | 'timeoutMs' | 'backoffMs'
> & {
  /** A window op, for the host window to act on: never one of the past. */
  onWindow?: (op: WindowOp) => void;
  /** Every op as it is applied, for a host that keeps more than the model. */
  onOp?: (op: UiOp, seq: number, history: boolean) => void;
};

export type UiSocketState = {
  model: UiModel;
  status: UiSocketStatus;
  /** Why the socket stopped or is reconnecting. */
  reason?: string;
  act: (action: Omit<UiAction, 'idempotency_id'> & { idempotency_id?: string | null }) => Promise<UiSocketResult>;
  state: (body: PatchOperation[]) => Promise<UiSocketResult>;
};

type Action = { kind: 'op'; op: UiOp } | { kind: 'reset' };

function reduce(model: UiModel, action: Action): UiModel {
  return action.kind === 'reset' ? emptyUiModel() : applyUiOp(model, action.op);
}

export function useUiSocket(options: UseUiSocketOptions): UiSocketState {
  const [model, dispatch] = useReducer(reduce, undefined, emptyUiModel);
  const [status, setStatus] = useState<{ status: UiSocketStatus; reason?: string }>({ status: 'connecting' });
  const latest = useRef(options);
  latest.current = options;
  const socket = useRef<UiSocket | null>(null);
  const { url, scope } = options;

  useEffect(() => {
    dispatch({ kind: 'reset' });
    const opened = new UiSocket({
      url,
      scope,
      token: () => latest.current.token(),
      open: latest.current.open,
      heartbeatMs: latest.current.heartbeatMs,
      timeoutMs: latest.current.timeoutMs,
      backoffMs: latest.current.backoffMs,
      onOp: (op, seq, history) => {
        if (op.op === 'window' && !history) {
          latest.current.onWindow?.(op);
        }
        latest.current.onOp?.(op, seq, history);
        dispatch({ kind: 'op', op });
      },
      onStatus: (next, reason) => setStatus({ status: next, reason }),
    });
    socket.current = opened;
    opened.connect();
    return () => {
      opened.close();
      if (socket.current === opened) {
        socket.current = null;
      }
    };
  }, [url, scope]);

  const act = useCallback<UiSocketState['act']>((action) => {
    const open = socket.current;
    return open ? open.act(action) : Promise.reject(new Error('The ui socket is not open'));
  }, []);

  const state = useCallback<UiSocketState['state']>((body) => {
    const open = socket.current;
    return open ? open.state(body) : Promise.reject(new Error('The ui socket is not open'));
  }, []);

  return { model, status: status.status, reason: status.reason, act, state };
}
