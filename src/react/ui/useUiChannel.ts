/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Keep a stream of ops as a model, in a component.
 *
 * The host's transport calls `emit` with each op it receives; the component
 * draws `model`. With a `scope`, ops of other scopes are ignored, so one
 * stream can feed several views. `window` ops change no state: they go to
 * `onWindow`, for the host to act on.
 *
 * ```tsx
 * const { model, emit } = useUiChannel({ scope: sessionId });
 * useEffect(() => stream.on('reactor.ui', emit), [stream, emit]);
 * return orderedDisplays(model).map(d => <ReactorDisplay key={d.id} display={d} />);
 * ```
 *
 * @module react/ui/useUiChannel
 */

import { useCallback, useReducer, useRef } from 'react';
import { applyUiOps, emptyUiModel, type UiModel } from '../../ui/reducer';
import type { UiOp, WindowOp } from '../../ui/wire';

export type UseUiChannelOptions = {
  scope?: string;
  initial?: UiModel;
  onWindow?: (op: WindowOp) => void;
};

export type UiChannelState = {
  model: UiModel;
  /** Apply one op, or several in order. */
  emit: (ops: UiOp | readonly UiOp[]) => void;
  /** Back to the empty model, or the one given. */
  reset: (model?: UiModel) => void;
};

type Action = { kind: 'ops'; ops: readonly UiOp[] } | { kind: 'reset'; model: UiModel };

function reduce(model: UiModel, action: Action): UiModel {
  return action.kind === 'reset' ? action.model : applyUiOps(model, action.ops);
}

export function useUiChannel(options: UseUiChannelOptions = {}): UiChannelState {
  const [model, dispatch] = useReducer(reduce, options.initial ?? emptyUiModel());
  // Read at emit time, so a host passing a fresh callback each render does not
  // hand out a fresh `emit` each render too.
  const latest = useRef(options);
  latest.current = options;

  const emit = useCallback((ops: UiOp | readonly UiOp[]) => {
    const { scope, onWindow } = latest.current;
    const list = (Array.isArray(ops) ? ops : [ops]) as UiOp[];
    const mine = scope === undefined ? list : list.filter((op) => op.scope === scope);
    for (const op of mine) {
      if (op.op === 'window') {
        onWindow?.(op);
      }
    }
    dispatch({ kind: 'ops', ops: mine });
  }, []);

  const reset = useCallback((next?: UiModel) => {
    dispatch({ kind: 'reset', model: next ?? emptyUiModel() });
  }, []);

  return { model, emit, reset };
}
