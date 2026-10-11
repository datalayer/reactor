/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The wire between a host and the page: one envelope, eight ops.
 *
 * `{ v: 1, op, scope, id, body }` — `show` a display, `patch` it (RFC 6902),
 * `append` to an array in it, `remove` it; `state` patches the scope's shared
 * state; `ask` shows a display that waits for an answer; `window` is a
 * message for the host window; `meta` merges facts about the scope.
 *
 * The pydantic models in `reactor.ui.wire` are canonical; the JSON Schema in
 * `schema/reactor-ui.v1.schema.json` is generated from them, and these types
 * follow the schema. `scripts/generate-ui-types.mjs` regenerates them with
 * json-schema-to-typescript where it is installed; {@link UI_WIRE_FIELDS} is
 * what the drift test compares against the schema either way.
 *
 * @module ui/wire
 */

/** The envelope version every op carries. */
export const UI_WIRE_VERSION = 1;

/** The key a tool result's `_meta` carries a display under. */
export const DISPLAY_META_KEY = 'reactor.ui/display';

/** One RFC 6902 operation. */
export type PatchOperation = {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string | null;
};

/** Something a display lets the page press, with the token the server minted. */
export type ActionOffer = {
  name: string;
  label?: string | null;
  token: string;
};

/** A file by reference. Files never ride inside JSON. */
export type FileRef = {
  ref: string;
  name: string;
  media_type: string;
  size?: number | null;
  url?: string | null;
};

/**
 * A display: a typed payload with a mandatory text fallback.
 *
 * `type` is MIME-like (`application/vnd.datalayer.pap.sign-in+json`); a
 * renderer contributes for a type and a range of versions. `text` is what
 * a page with no renderer for it shows.
 */
export type Display = {
  type: string;
  version?: number;
  id: string;
  text: string;
  data?: Record<string, unknown>;
  actions?: ActionOffer[];
};

/** What an `append` pushes, and onto which array of the display. */
export type AppendBody = { path: string; value?: unknown };

/** A message for the host window. */
export type WindowBody = { name: string; args?: Record<string, unknown> };

type OpBase = { v: 1; scope: string; id?: string | null };

export type ShowOp = OpBase & { op: 'show'; body: Display };
export type PatchOp = OpBase & { op: 'patch'; id: string; body: PatchOperation[] };
export type AppendOp = OpBase & { op: 'append'; id: string; body: AppendBody };
export type RemoveOp = OpBase & { op: 'remove'; id: string; body?: null };
export type StateOp = OpBase & { op: 'state'; body: PatchOperation[] };
export type AskOp = OpBase & { op: 'ask'; body: Display };
export type WindowOp = OpBase & { op: 'window'; body: WindowBody };
export type MetaOp = OpBase & { op: 'meta'; body: Record<string, unknown> };

/** One op of the envelope, told apart by `op`. */
export type UiOp = ShowOp | PatchOp | AppendOp | RemoveOp | StateOp | AskOp | WindowOp | MetaOp;

export type UiOpName = UiOp['op'];

/** The page pressing something a display offered. */
export type UiAction = {
  action: string;
  display_id: string;
  token: string;
  payload?: Record<string, unknown>;
  idempotency_id?: string | null;
};

/** How a host lets a renderer press an action a display offered. */
export type UiAct = (
  action: Omit<UiAction, 'token' | 'display_id'> & { display_id?: string; token?: string },
) => void | Promise<unknown>;

type Fields<T> = readonly (keyof T)[];

/**
 * Every property of every wire type, by its schema name.
 *
 * Runtime evidence of the types above: the compiler checks each name is a
 * key of its type, and the drift test checks the lists are exactly the
 * schema's properties.
 */
export const UI_WIRE_FIELDS = {
  ActionOffer: ['name', 'label', 'token'] satisfies Fields<ActionOffer>,
  AppendBody: ['path', 'value'] satisfies Fields<AppendBody>,
  AppendOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<AppendOp>,
  AskOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<AskOp>,
  DisplayWire: ['type', 'version', 'id', 'text', 'data', 'actions'] satisfies Fields<Display>,
  FileRef: ['ref', 'name', 'media_type', 'size', 'url'] satisfies Fields<FileRef>,
  MetaOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<MetaOp>,
  PatchOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<PatchOp>,
  PatchOperation: ['op', 'path', 'value', 'from'] satisfies Fields<PatchOperation>,
  RemoveOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<RemoveOp>,
  ShowOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<ShowOp>,
  StateOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<StateOp>,
  UiAction: ['action', 'display_id', 'token', 'payload', 'idempotency_id'] satisfies Fields<UiAction>,
  WindowBody: ['name', 'args'] satisfies Fields<WindowBody>,
  WindowOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<WindowOp>,
} as const;

/** The op names, as the schema's discriminator lists them. */
export const UI_OP_NAMES: readonly UiOpName[] = [
  'show',
  'patch',
  'append',
  'remove',
  'state',
  'ask',
  'window',
  'meta',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a value has the shape of a display. */
export function isDisplay(value: unknown): value is Display {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    (value.version === undefined || typeof value.version === 'number') &&
    (value.data === undefined || isRecord(value.data)) &&
    (value.actions === undefined || Array.isArray(value.actions))
  );
}

/** Whether a value is an op of this wire version. */
export function isUiOp(value: unknown): value is UiOp {
  return (
    isRecord(value) &&
    value.v === UI_WIRE_VERSION &&
    typeof value.scope === 'string' &&
    UI_OP_NAMES.includes(value.op as UiOpName)
  );
}
