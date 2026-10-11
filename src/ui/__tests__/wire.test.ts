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
