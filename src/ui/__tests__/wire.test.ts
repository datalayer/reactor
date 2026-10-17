/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { describe, expect, it } from 'vitest';
import { UI_OP_NAMES, UI_WIRE_FIELDS, isDisplay, isUiOp } from '../wire';

type Schema = {
  $defs: Record<string, { properties?: Record<string, unknown> } & Record<string, unknown>>;
};

/**
 * The committed schema, read from disk.
 *
 * Through a specifier the compiler cannot see: the package is typed without
 * Node's declarations (`types: []`), and the tests run under Node anyway.
 */
async function committedSchema(): Promise<Schema> {
  const fs: string = 'node:fs';
  const { readFileSync } = await import(/* @vite-ignore */ fs);
  const url = new URL('../../../schema/reactor-ui.v1.schema.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Schema;
}

describe('the wire types follow the schema', () => {
  it('names every definition the schema has, and only those', async () => {
    const schema = await committedSchema();
    const objects = Object.keys(schema.$defs).filter((name) => schema.$defs[name].properties);
    expect(Object.keys(UI_WIRE_FIELDS).sort()).toEqual(objects.sort());
  });

  it('has exactly the properties of each definition', async () => {
    const schema = await committedSchema();
    for (const [name, fields] of Object.entries(UI_WIRE_FIELDS)) {
      expect([...fields].sort(), name).toEqual(Object.keys(schema.$defs[name].properties ?? {}).sort());
    }
  });

  it('lists the ops the discriminator maps', async () => {
    const schema = await committedSchema();
    const mapping = (schema.$defs.UiOp.discriminator as { mapping: Record<string, string> }).mapping;
    expect([...UI_OP_NAMES].sort()).toEqual(Object.keys(mapping).sort());
  });
});

describe('guards', () => {
  it('tells a display and an op', () => {
    const display = { type: 'application/vnd.t+json', id: 'a', text: 'A' };
    expect(isDisplay(display)).toBe(true);
    expect(isDisplay({ type: 'x', id: 'a' })).toBe(false);
    expect(isUiOp({ v: 1, op: 'show', scope: 's', body: display })).toBe(true);
    expect(isUiOp({ v: 2, op: 'show', scope: 's', body: display })).toBe(false);
    expect(isUiOp({ v: 1, op: 'shout', scope: 's' })).toBe(false);
  });
});

describe('isUiOp checks the body each op needs', () => {
  const display = { type: 'application/vnd.t+json', id: 'a', text: 'A' };
  const ops: [unknown, boolean][] = [
    [{ v: 1, op: 'show', scope: 's', body: display }, true],
    [{ v: 1, op: 'show', scope: 's' }, false],
    [{ v: 1, op: 'show', scope: 's', body: { type: 'x', id: 'a' } }, false],
    [{ v: 1, op: 'show', scope: 's', body: { ...display, actions: [{ name: 'n' }] } }, false],
    [{ v: 1, op: 'ask', scope: 's', body: display }, true],
    [{ v: 1, op: 'ask', scope: 's', body: {} }, false],
    [{ v: 1, op: 'patch', scope: 's', id: 'a', body: [{ op: 'replace', path: '/text', value: null }] }, true],
    [{ v: 1, op: 'patch', scope: 's' }, false],
    [{ v: 1, op: 'patch', scope: 's', body: [] }, false],
    [{ v: 1, op: 'patch', scope: 's', id: 'a', body: {} }, false],
    [{ v: 1, op: 'patch', scope: 's', id: 'a', body: [{ op: 'replace', path: '/text' }] }, false],
    [{ v: 1, op: 'patch', scope: 's', id: 'a', body: [{ op: 'move', path: '/b' }] }, false],
    [{ v: 1, op: 'patch', scope: 's', id: 'a', body: [{ op: 'move', path: '/b', from: '/a' }] }, true],
    [{ v: 1, op: 'patch', scope: 's', id: 'a', body: [{ op: 'shout', path: '/b' }] }, false],
    [{ v: 1, op: 'append', scope: 's', id: 'a', body: { path: '/data/items', value: 1 } }, true],
    [{ v: 1, op: 'append', scope: 's', id: 'a', body: { value: 1 } }, false],
    [{ v: 1, op: 'append', scope: 's', body: { path: '/data/items' } }, false],
    [{ v: 1, op: 'remove', scope: 's', id: 'a' }, true],
    [{ v: 1, op: 'remove', scope: 's' }, false],
    [{ v: 1, op: 'remove', scope: 's', id: 'a', body: {} }, false],
    [{ v: 1, op: 'state', scope: 's', body: [{ op: 'add', path: '/k', value: 1 }] }, true],
    [{ v: 1, op: 'state', scope: 's', body: [{ op: 'add', path: '/k' }] }, false],
    [{ v: 1, op: 'state', scope: 's' }, false],
    [{ v: 1, op: 'window', scope: 's', body: { name: 'focus' } }, true],
    [{ v: 1, op: 'window', scope: 's', body: { args: {} } }, false],
    [{ v: 1, op: 'window', scope: 's' }, false],
    [{ v: 1, op: 'meta', scope: 's', body: { title: 'T' } }, true],
    [{ v: 1, op: 'meta', scope: 's', body: [] }, false],
    [{ v: 1, op: 'meta', scope: 's' }, false],
    [{ v: 1, op: 'show', scope: 's', id: 3, body: display }, false],
  ];

  it.each(ops)('%j -> %s', (op, valid) => {
    expect(isUiOp(op)).toBe(valid);
  });
});
