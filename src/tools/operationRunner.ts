/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * Runs an operation and formats what it answers; subscribes to one that
 * streams.
 *
 * @module tools/operationRunner
 */

import type { ToolOperation, ToolExecutionContext, ToolStreamPush, ToolStreamStop } from './interfaces';
import { formatResponse } from './formatter';

export class OperationRunner {
  /**
   * Execute an operation and format its result for the context's reader.
   *
   * Nothing is logged here. This used to print the operation, its
   * parameters, the whole context and the result on every single tool call.
   * The context carries `extras`, which is where platforms put their SDK
   * handles and credentials, so the logging was both unreadable and a place
   * for a token to end up in a browser console. A caller that wants to watch
   * tool traffic can wrap the executor, which sees the same calls without
   * the context.
   */
  async execute<TParams, TResult>(
    operation: ToolOperation<TParams, TResult>,
    params: TParams,
    context: ToolExecutionContext,
  ): Promise<TResult | string> {
    const result = await operation.execute(params, context);
    return formatResponse(result, context.format);
  }

  /**
   * Subscribe to an operation that streams: its events go to `push` until
   * the stop returned is called. Refused, in a sentence, for an operation
   * that does not stream.
   */
  async subscribe<TParams, TResult>(
    operation: ToolOperation<TParams, TResult>,
    params: TParams,
    context: ToolExecutionContext,
    push: ToolStreamPush,
  ): Promise<ToolStreamStop> {
    if (!operation.subscribe) {
      throw new Error(`Operation '${operation.name}' does not stream: it has no subscribe.`);
    }
    return operation.subscribe(params, context, push);
  }
}
