/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The runner over an executor: an operation reaches its store by name, its
 * result goes back as TOON or as the object, and an operation that streams
 * pushes events until it is stopped.
 */

import { describe, expect, it, vi } from 'vitest';
import { DefaultExecutor, OperationRunner, type ToolExecutionContext, type ToolOperation, type ToolStreamEvent } from '../index';

const store = {
  readCell: ({ id, index }: { id: string; index: number }) => ({ id, index, source: 'print(1)' }),
};

const readCell: ToolOperation<{ index: number }, unknown> = {
  name: 'readCell',
  execute: (params, context) => context.executor.execute('readCell', params),
};

const contextOf = (format?: 'json' | 'toon'): ToolExecutionContext => ({
  executor: new DefaultExecutor('doc-1', store),
  documentId: 'doc-1',
  ...(format ? { format } : {}),
});

describe('the operation runner', () => {
  it("reaches the store's method of the operation's name, the document's id first", async () => {
    const result = await new OperationRunner().execute(readCell, { index: 2 }, contextOf('json'));
    expect(result).toEqual({ id: 'doc-1', index: 2, source: 'print(1)' });
  });

  it('answers TOON unless JSON is asked for', async () => {
    const toon = await new OperationRunner().execute(readCell, { index: 2 }, contextOf());
    expect(typeof toon).toBe('string');
    expect(toon).toContain('print(1)');
  });

  it('refuses an operation whose store has no such method', async () => {
    const missing: ToolOperation<unknown, unknown> = { name: 'nothing', execute: (_p, c) => c.executor.execute('nothing', {}) };
    await expect(new OperationRunner().execute(missing, {}, contextOf())).rejects.toThrow(/'nothing' not found/);
  });
});

describe('an operation that streams', () => {
  it('pushes events until stopped, and is refused when it has no subscribe', async () => {
    const pushes: ToolStreamEvent[] = [];
    let ticks = 0;
    const watch: ToolOperation<{ every: number }, { subscribed: true }> = {
      name: 'arena_watch',
      execute: async () => ({ subscribed: true }),
      subscribe: (_params, _context, push) => {
        const timer = setInterval(() => push({ source: 'arena-pong', tick: ++ticks, at: ticks, says: `tick ${ticks}` }), 1);
        return () => clearInterval(timer);
      },
    };
    vi.useFakeTimers();
    const stop = await new OperationRunner().subscribe(watch, { every: 1 }, contextOf(), event => pushes.push(event));
    vi.advanceTimersByTime(3);
    stop();
    vi.advanceTimersByTime(3);
    vi.useRealTimers();
    expect(pushes.map(event => event.says)).toEqual(['tick 1', 'tick 2', 'tick 3']);
    await expect(new OperationRunner().subscribe(readCell, { index: 0 }, contextOf(), () => undefined)).rejects.toThrow(/'readCell' does not stream/);
  });
});
