/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * What a page holds after a stream of ops: a pure reducer.
 *
 * `applyUiOp(model, op)` returns a new model and never touches the old one,
 * so a React reducer, a store, or a test can hold it. `window` ops change
 * nothing here — they are for the host window to act on, not state to keep.
 *
 * Fails fast: an op of another wire version, a patch against a display that
 * was never shown, a patch whose `test` fails — each throws rather than
 * leaving the page drawing something the server did not say.
 *
 * @module ui/reducer
 */

import { UI_WIRE_VERSION, type Display, type PatchOperation, type UiOp } from './wire';

export type UiModel = {
  /** Displays by id. */
  displays: Record<string, Display>;
  /** Display ids in the order they were first shown. */
  order: string[];
  /** Ids of the displays shown by `ask`, still waiting for an answer. */
  asks: string[];
  /** The scope's shared state, as `state` ops patched it. */
  state: unknown;
  /** Facts about the scope, as `meta` ops merged them. */
  meta: Record<string, unknown>;
};

export function emptyUiModel(): UiModel {
  return { displays: {}, order: [], asks: [], state: {}, meta: {} };
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function parsePointer(pointer: string): string[] {
  if (pointer === '') {
    return [];
  }
  if (!pointer.startsWith('/')) {
    throw new Error(`A JSON pointer starts with '/': ${pointer}`);
  }
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((token) => {
      if (FORBIDDEN_TOKENS.has(token)) {
        throw new Error(`${pointer}: '${token}' is never a path token`);
      }
      return token;
    });
}

/** Tokens that lead into a prototype rather than into the document. */
const FORBIDDEN_TOKENS = new Set(['__proto__', 'constructor', 'prototype']);

function hasOwn(node: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(node, key);
}

type Container = Record<string, unknown> | unknown[];

function walk(document: unknown, tokens: string[], pointer: string): Container {
  let node = document;
  for (const token of tokens) {
    if (Array.isArray(node)) {
      node = node[arrayIndex(node, token, pointer, false)];
    } else if (typeof node === 'object' && node !== null && hasOwn(node, token)) {
      node = (node as Record<string, unknown>)[token];
    } else {
      throw new Error(`No value at ${pointer}`);
    }
  }
  if (typeof node !== 'object' || node === null) {
    throw new Error(`${pointer} does not lead into an object or an array`);
  }
  return node as Container;
}

function arrayIndex(array: unknown[], token: string, pointer: string, forAdd: boolean): number {
  if (forAdd && token === '-') {
    return array.length;
  }
  if (!/^(0|[1-9][0-9]*)$/.test(token)) {
    throw new Error(`${pointer}: '${token}' is not an array index`);
  }
  const index = Number(token);
  if (index > array.length || (!forAdd && index === array.length)) {
    throw new Error(`${pointer}: index ${index} is out of bounds`);
  }
  return index;
}

function read(document: unknown, pointer: string): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    return document;
  }
  const parent = walk(document, tokens.slice(0, -1), pointer);
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    return parent[arrayIndex(parent, last, pointer, false)];
  }
  if (!hasOwn(parent, last)) {
    throw new Error(`No value at ${pointer}`);
  }
  return parent[last];
}

function add(document: unknown, pointer: string, value: unknown): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    return value;
  }
  const parent = walk(document, tokens.slice(0, -1), pointer);
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    parent.splice(arrayIndex(parent, last, pointer, true), 0, value);
  } else {
    parent[last] = value;
  }
  return document;
}

function removeAt(document: unknown, pointer: string): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    return undefined;
  }
  const parent = walk(document, tokens.slice(0, -1), pointer);
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    parent.splice(arrayIndex(parent, last, pointer, false), 1);
  } else {
    if (!hasOwn(parent, last)) {
      throw new Error(`No value at ${pointer}`);
    }
    delete parent[last];
  }
  return document;
}

function replaceAt(document: unknown, pointer: string, value: unknown): unknown {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    return value;
  }
  const parent = walk(document, tokens.slice(0, -1), pointer);
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    parent[arrayIndex(parent, last, pointer, false)] = value;
  } else {
    if (!hasOwn(parent, last)) {
      throw new Error(`No value at ${pointer}`);
    }
    parent[last] = value;
  }
  return document;
}

/** JSON equality: arrays in order, objects by their set of keys, whatever their order. */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => equal(item, b[index]))
    );
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length && keys.every((key) => hasOwn(right, key) && equal(left[key], right[key]))
  );
}

/** RFC 6902 on a copy: the document handed in is never changed. */
export function applyPatch<T>(document: T, operations: readonly PatchOperation[]): T {
  let result: unknown = clone(document);
  for (const operation of operations) {
    switch (operation.op) {
      case 'add':
        result = add(result, operation.path, clone(operation.value));
        break;
      case 'remove':
        result = removeAt(result, operation.path);
        break;
      case 'replace':
        result = replaceAt(result, operation.path, clone(operation.value));
        break;
      case 'move': {
        const from = requireFrom(operation);
        const value = read(result, from);
        result = add(removeAt(result, from), operation.path, value);
        break;
      }
      case 'copy':
        result = add(result, operation.path, clone(read(result, requireFrom(operation))));
        break;
      case 'test':
        if (!equal(read(result, operation.path), operation.value)) {
          throw new Error(`test failed at ${operation.path}`);
        }
        break;
      default:
        throw new Error(`Unknown patch op ${(operation as { op: string }).op}`);
    }
  }
  return result as T;
}

function requireFrom(operation: { op: string; path: string; from?: unknown }): string {
  if (typeof operation.from !== 'string') {
    throw new Error(`'${operation.op}' at ${operation.path} needs 'from'`);
  }
  return operation.from;
}

function displayOf(model: UiModel, op: { op: string; id: string }): Display {
  const display = model.displays[op.id];
  if (!display) {
    throw new Error(`'${op.op}' for display '${op.id}', which was never shown`);
  }
  return display;
}

function shown(model: UiModel, display: Display): UiModel {
  const known = display.id in model.displays;
  return {
    ...model,
    displays: { ...model.displays, [display.id]: display },
    order: known ? model.order : [...model.order, display.id],
  };
}

/** The model after one op. */
export function applyUiOp(model: UiModel, op: UiOp): UiModel {
  if (op.v !== UI_WIRE_VERSION) {
    throw new Error(`reactor.ui wire v${String(op.v)} is not v${UI_WIRE_VERSION}`);
  }
  switch (op.op) {
    case 'show':
      return shown(model, op.body);
    case 'ask': {
      const next = shown(model, op.body);
      return next.asks.includes(op.body.id) ? next : { ...next, asks: [...next.asks, op.body.id] };
    }
    case 'patch': {
      const patched = applyPatch(displayOf(model, op), op.body);
      return { ...model, displays: { ...model.displays, [op.id]: { ...patched, id: op.id } } };
    }
    case 'append': {
      const display = displayOf(model, op);
      const appended = applyPatch(display, [{ op: 'add', path: `${op.body.path}/-`, value: op.body.value }]);
      return { ...model, displays: { ...model.displays, [op.id]: appended } };
    }
    case 'remove': {
      if (!(op.id in model.displays)) {
        return model;
      }
      const displays = { ...model.displays };
      delete displays[op.id];
      return {
        ...model,
        displays,
        order: model.order.filter((id) => id !== op.id),
        asks: model.asks.filter((id) => id !== op.id),
      };
    }
    case 'state':
      return { ...model, state: applyPatch(model.state, op.body) };
    case 'meta':
      return { ...model, meta: { ...model.meta, ...op.body } };
    case 'window':
      return model;
    default:
      throw new Error(`Unknown reactor.ui op '${(op as { op: string }).op}'`);
  }
}

/** The model after a list of ops. */
export function applyUiOps(model: UiModel, ops: readonly UiOp[]): UiModel {
  return ops.reduce(applyUiOp, model);
}

/** The displays in the order they were shown. */
export function orderedDisplays(model: UiModel): Display[] {
  return model.order.map((id) => model.displays[id]);
}
