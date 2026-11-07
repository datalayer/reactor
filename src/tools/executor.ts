/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The executor an operation reaches its document through.
 *
 * @module tools/executor
 */

/** A store whose methods are the operations, looked up by name. */
interface ToolStore {
  [key: string]: unknown;
}

/** Where an operation's work is done: a store, a bridge to another process, a mock. */
export interface ToolExecutor {
  /**
   * Execute a tool operation
   *
   * @param operationName - Name of the operation (e.g., "insertCell", "runCell")
   * @param args - Operation arguments
   * @returns Result from execution
   */
  execute(operationName: string, args: unknown): Promise<unknown>;
}

/**
 * The executor over a store: each operation is the store's method of the
 * same name, called with `{ id, ...args }` — the document's id first.
 */
export class DefaultExecutor implements ToolExecutor {
  constructor(
    private documentId: string,
    private store: ToolStore,
  ) {}

  /**
   * Execute an operation by calling the corresponding store method.
   * Builds payload with documentId and spreads values as individual parameters.
   *
   * @param operationName - Name of the operation (e.g., "insertCell", "deleteCell")
   * @param args - Operation arguments as an object
   * @returns Result from store method
   */
  async execute(operationName: string, args: unknown): Promise<unknown> {
    // Get the store method directly (1:1 mapping, no transformation)
    const method = (this.store as unknown as Record<string, unknown>)[operationName];
    if (typeof method !== 'function') {
      throw new Error(`Store method '${operationName}' not found or not a function`);
    }
    // Build payload: { id, ...args } - pass as single object parameter
    const payload =
      typeof args === 'object' && args !== null ? { id: this.documentId, ...args } : { id: this.documentId };
    // Call method with payload object as first parameter
    // Methods will check if first param is object and destructure accordingly
    const methodFn = method as (payload: unknown) => unknown;
    const result = await methodFn.call(this.store, payload);
    return result;
  }
}
