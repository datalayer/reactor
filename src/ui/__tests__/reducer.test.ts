/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { describe, expect, it } from 'vitest';
import { applyPatch, applyUiOp, applyUiOps, emptyUiModel, orderedDisplays } from '../reducer';
import type { Display, UiOp } from '../wire';

const card = (id: string, text = id): Display => ({ type: 'application/vnd.t+json', id, text, data: { items: [] } });

describe('applyUiOp', () => {
  it('shows, patches, appends and removes without touching the model it was given', () => {
    const start = emptyUiModel();
    const ops: UiOp[] = [
      { v: 1, op: 'show', scope: 's', body: card('a') },
      { v: 1, op: 'show', scope: 's', body: card('b') },
      { v: 1, op: 'patch', scope: 's', id: 'a', body: [{ op: 'replace', path: '/text', value: 'A!' }] },
      { v: 1, op: 'append', scope: 's', id: 'a', body: { path: '/data/items', value: 1 } },
      { v: 1, op: 'append', scope: 's', id: 'a', body: { path: '/data/items', value: 2 } },
      { v: 1, op: 'show', scope: 's', body: card('b', 'B again') },
    ];
    const model = applyUiOps(start, ops);
    expect(start).toEqual(emptyUiModel());
    expect(orderedDisplays(model).map((d) => d.text)).toEqual(['A!', 'B again']);
    expect(model.displays.a.data).toEqual({ items: [1, 2] });

    const removed = applyUiOp(model, { v: 1, op: 'remove', scope: 's', id: 'a' });
    expect(removed.order).toEqual(['b']);
    expect(model.order).toEqual(['a', 'b']);
  });

  it('remembers what was asked until it goes', () => {
    let model = applyUiOp(emptyUiModel(), { v: 1, op: 'ask', scope: 's', body: card('q') });
    expect(model.asks).toEqual(['q']);
    model = applyUiOp(model, { v: 1, op: 'remove', scope: 's', id: 'q' });
    expect(model.asks).toEqual([]);
  });

  it('patches state, merges meta, and keeps nothing of a window op', () => {
    let model = applyUiOps(emptyUiModel(), [
      { v: 1, op: 'state', scope: 's', body: [{ op: 'add', path: '/count', value: 1 }] },
      { v: 1, op: 'state', scope: 's', body: [{ op: 'replace', path: '/count', value: 2 }] },
      { v: 1, op: 'meta', scope: 's', body: { title: 'One' } },
      { v: 1, op: 'meta', scope: 's', body: { author: 'Ada' } },
    ]);
    expect(model.state).toEqual({ count: 2 });
    expect(model.meta).toEqual({ title: 'One', author: 'Ada' });
    expect(applyUiOp(model, { v: 1, op: 'window', scope: 's', body: { name: 'focus' } })).toBe(model);
  });

  it('fails fast', () => {
    expect(() => applyUiOp(emptyUiModel(), { v: 1, op: 'patch', scope: 's', id: 'x', body: [] })).toThrow(
      /never shown/,
    );
    expect(() => applyUiOp(emptyUiModel(), { v: 2, op: 'meta', scope: 's', body: {} } as unknown as UiOp)).toThrow(
      /v2/,
    );
  });
});

describe('applyPatch (RFC 6902)', () => {
  it('runs every op', () => {
    const doc = { a: { b: [1, 2, 3] }, c: 'x' };
    const out = applyPatch(doc, [
      { op: 'add', path: '/a/b/1', value: 9 },
      { op: 'remove', path: '/a/b/0' },
      { op: 'replace', path: '/c', value: 'y' },
      { op: 'copy', from: '/c', path: '/d' },
      { op: 'move', from: '/d', path: '/e~1f' },
      { op: 'test', path: '/e~1f', value: 'y' },
    ]);
    expect(out).toEqual({ a: { b: [9, 2, 3] }, c: 'y', 'e/f': 'y' });
    expect(doc).toEqual({ a: { b: [1, 2, 3] }, c: 'x' });
  });

  it('refuses a failed test and a missing target', () => {
    expect(() => applyPatch({ a: 1 }, [{ op: 'test', path: '/a', value: 2 }])).toThrow(/test failed/);
    expect(() => applyPatch({ a: 1 }, [{ op: 'replace', path: '/b', value: 2 }])).toThrow(/No value/);
    expect(() => applyPatch({ a: [] }, [{ op: 'remove', path: '/a/0' }])).toThrow(/out of bounds/);
  });
});
