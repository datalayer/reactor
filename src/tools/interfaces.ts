/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * How a tool runs: the operation behind a definition, the context it runs
 * in, and, for a tool that streams, the events it pushes.
 *
 * @module tools/interfaces
 */

import type { ToolExecutor } from './executor';

/** Execution context for tool operations. */
export interface ToolExecutionContext {
  /** Tool executor (DefaultExecutor, BridgeExecutor, etc.) */
  executor: ToolExecutor;
  /** Document identifier - universal for notebooks, lexicals, etc. (file URI or document UID) */
  documentId?: string;
  /** Response format: "json" (default) or "toon" */
  format?: 'json' | 'toon';
  /** Platform-specific additional context */
  extras?: Record<string, unknown>;
}

/**
 * One event a streaming tool pushes: where it comes from, when, and the
 * state in words a model acts on, beside the data.
 */
export interface ToolStreamEvent {
  /** What pushed it: the arena's id, `arena-pong`. */
  source: string;
  /** The source's own clock, when it has one: the arena's tick. */
  tick?: number;
  /** When it was pushed, as a time in milliseconds. */
  at: number;
  /** The state, in words a model acts on. */
  says: string;
  /** The state, as data. */
  state?: unknown;
}

/** Where a streaming operation pushes its events. */
export type ToolStreamPush = (event: ToolStreamEvent) => void;

/** How a subscription is ended. */
export type ToolStreamStop = () => void;

/**
 * Platform-agnostic tool operation interface.
 *
 * @template TParams - Tool parameter type
 * @template TResult - Tool result type
 */
export interface ToolOperation<TParams, TResult> {
  /** Operation name (matches ToolDefinition.operation field) */
  name: string;
  /**
   * Execute the operation.
   *
   * @param params - Tool parameters
   * @param context - Execution context
   * @returns Operation result
   */
  execute(params: TParams, context: ToolExecutionContext): Promise<TResult>;
  /**
   * For an operation that streams (its definition says `streams`): start
   * pushing events for one call, and return how to stop. `execute` still
   * answers the call itself — *subscribed*, or the first state.
   */
  subscribe?(
    params: TParams,
    context: ToolExecutionContext,
    push: ToolStreamPush,
  ): Promise<ToolStreamStop> | ToolStreamStop;
}

// Re-export ToolExecutor for convenience
export type { ToolExecutor };
