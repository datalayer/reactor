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

/** RFC 6902 `add`. `value` must be there; `null` is a value. */
export type PatchAdd = { op: 'add'; path: string; value: unknown };
/** RFC 6902 `remove`: the path, nothing else. */
export type PatchRemove = { op: 'remove'; path: string };
/** RFC 6902 `replace`. `value` must be there; `null` is a value. */
export type PatchReplace = { op: 'replace'; path: string; value: unknown };
/** RFC 6902 `move`, from `from` to `path`. */
export type PatchMove = { op: 'move'; path: string; from: string };
/** RFC 6902 `copy`, from `from` to `path`. */
export type PatchCopy = { op: 'copy'; path: string; from: string };
/** RFC 6902 `test`. `value` must be there; `null` is a value. */
export type PatchTest = { op: 'test'; path: string; value: unknown };

/** One RFC 6902 operation, told apart by `op`, each with the members it needs. */
export type PatchOperation = PatchAdd | PatchRemove | PatchReplace | PatchMove | PatchCopy | PatchTest;

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

/**
 * The action that answers a display shown by `ask` (REACTOR_UI P5): its
 * payload is an `Answer`, which the host checks against what it asked.
 */
export const ANSWER_ACTION = 'reactor.answer';

/** What answers a question: a choice, the words, a form's values. */
export type Answer = { value: unknown };

/** The page pressing something a display offered. */
export type UiAction = {
  action: string;
  display_id: string;
  token: string;
  payload?: Record<string, unknown>;
  idempotency_id?: string | null;
};

/*
 * The socket's frames (REACTOR_UI RU-W): one WebSocket per conversation,
 * ops down numbered, presses and page state up, each told apart by `t`.
 */

/** Up, first and only once: the credential (never in the URL), the scope, the last op applied. */
export type HelloFrame = { t: 'hello'; v?: 1; token: string; scope: string; since?: number | null };
/** Up: a press of something a display offered; `ref` names its result. */
export type ActionFrame = { t: 'action'; ref: string; action: UiAction };
/** Up: RFC 6902 operations against the scope's shared state. */
export type StateFrame = { t: 'state'; ref: string; body: PatchOperation[] };
/** Either way: are you there? */
export type PingFrame = { t: 'ping' };
/** Either way: the answer to a ping. */
export type PongFrame = { t: 'pong' };
/** Down, first: the hello accepted; `seq` is the scope's last op now. */
export type WelcomeFrame = { t: 'welcome'; v?: 1; scope: string; seq: number };
/** Down: one op, numbered one more than the last of its scope. */
export type OpFrame = { t: 'op'; seq: number; op: UiOp };
/** Down: what came of an action or a state frame, by its `ref`, with the HTTP status a route would answer. */
export type ResultFrame = {
  t: 'result';
  ref: string;
  ok: boolean;
  status: number;
  detail?: string | null;
  value?: unknown;
};

/** What the page sends. */
export type UpFrame = HelloFrame | ActionFrame | StateFrame | PingFrame | PongFrame;
/** What the host sends. */
export type DownFrame = WelcomeFrame | OpFrame | ResultFrame | PingFrame | PongFrame;

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
  ActionFrame: ['t', 'ref', 'action'] satisfies Fields<ActionFrame>,
  ActionOffer: ['name', 'label', 'token'] satisfies Fields<ActionOffer>,
  AppendBody: ['path', 'value'] satisfies Fields<AppendBody>,
  AppendOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<AppendOp>,
  AskOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<AskOp>,
  DisplayWire: ['type', 'version', 'id', 'text', 'data', 'actions'] satisfies Fields<Display>,
  FileRef: ['ref', 'name', 'media_type', 'size', 'url'] satisfies Fields<FileRef>,
  HelloFrame: ['t', 'v', 'token', 'scope', 'since'] satisfies Fields<HelloFrame>,
  MetaOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<MetaOp>,
  OpFrame: ['t', 'seq', 'op'] satisfies Fields<OpFrame>,
  PatchAdd: ['op', 'path', 'value'] satisfies Fields<PatchAdd>,
  PatchCopy: ['op', 'path', 'from'] satisfies Fields<PatchCopy>,
  PatchMove: ['op', 'path', 'from'] satisfies Fields<PatchMove>,
  PatchOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<PatchOp>,
  PatchRemove: ['op', 'path'] satisfies Fields<PatchRemove>,
  PatchReplace: ['op', 'path', 'value'] satisfies Fields<PatchReplace>,
  PatchTest: ['op', 'path', 'value'] satisfies Fields<PatchTest>,
  PingFrame: ['t'] satisfies Fields<PingFrame>,
  PongFrame: ['t'] satisfies Fields<PongFrame>,
  RemoveOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<RemoveOp>,
  ResultFrame: ['t', 'ref', 'ok', 'status', 'detail', 'value'] satisfies Fields<ResultFrame>,
  ShowOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<ShowOp>,
  StateFrame: ['t', 'ref', 'body'] satisfies Fields<StateFrame>,
  StateOp: ['v', 'op', 'scope', 'id', 'body'] satisfies Fields<StateOp>,
  UiAction: ['action', 'display_id', 'token', 'payload', 'idempotency_id'] satisfies Fields<UiAction>,
  WelcomeFrame: ['t', 'v', 'scope', 'seq'] satisfies Fields<WelcomeFrame>,
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

function isOptional(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === undefined || value === null || check(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isActionOffer(value: unknown): value is ActionOffer {
  return isRecord(value) && isString(value.name) && isString(value.token) && isOptional(value.label, isString);
}

/** Whether a value has the shape of a display. */
export function isDisplay(value: unknown): value is Display {
  return (
    isRecord(value) &&
    isString(value.type) &&
    isString(value.id) &&
    isString(value.text) &&
    (value.version === undefined || Number.isInteger(value.version)) &&
    (value.data === undefined || isRecord(value.data)) &&
    (value.actions === undefined || (Array.isArray(value.actions) && value.actions.every(isActionOffer)))
  );
}

/** Whether a value is one RFC 6902 operation with the members its `op` needs. */
export function isPatchOperation(value: unknown): value is PatchOperation {
  if (!isRecord(value) || !isString(value.path)) {
    return false;
  }
  switch (value.op) {
    case 'add':
    case 'replace':
    case 'test':
      return 'value' in value;
    case 'remove':
      return true;
    case 'move':
    case 'copy':
      return isString(value.from);
    default:
      return false;
  }
}

function isPatch(value: unknown): value is PatchOperation[] {
  return Array.isArray(value) && value.every(isPatchOperation);
}

/** What each op requires of its `id` and `body`, as `reactor.ui.wire` declares it. */
const OP_SHAPES: Record<UiOpName, (op: Record<string, unknown>) => boolean> = {
  show: (op) => isDisplay(op.body),
  ask: (op) => isDisplay(op.body),
  patch: (op) => isString(op.id) && isPatch(op.body),
  append: (op) => isString(op.id) && isRecord(op.body) && isString(op.body.path),
  remove: (op) => isString(op.id) && (op.body === undefined || op.body === null),
  state: (op) => isPatch(op.body),
  window: (op) => isRecord(op.body) && isString(op.body.name) && (op.body.args === undefined || isRecord(op.body.args)),
  meta: (op) => isRecord(op.body),
};

/** Whether a value is an op of this wire version, with the `id` and `body` its op needs. */
export function isUiOp(value: unknown): value is UiOp {
  return (
    isRecord(value) &&
    value.v === UI_WIRE_VERSION &&
    isString(value.scope) &&
    isOptional(value.id, isString) &&
    UI_OP_NAMES.includes(value.op as UiOpName) &&
    OP_SHAPES[value.op as UiOpName](value)
  );
}

function isSeq(value: unknown, least: number): value is number {
  return Number.isInteger(value) && (value as number) >= least;
}

/** Exactly these keys, the required ones among them: a frame says nothing else. */
function hasKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => key in value) && keys.every((key) => required.includes(key) || optional.includes(key));
}

/** Whether a value is a frame the host sends, with nothing it does not declare. */
export function isDownFrame(value: unknown): value is DownFrame {
  if (!isRecord(value)) {
    return false;
  }
  switch (value.t) {
    case 'welcome':
      return (
        hasKeys(value, ['t', 'scope', 'seq'], ['v']) &&
        (value.v === undefined || value.v === UI_WIRE_VERSION) &&
        isString(value.scope) &&
        isSeq(value.seq, 0)
      );
    case 'op':
      return hasKeys(value, ['t', 'seq', 'op']) && isSeq(value.seq, 1) && isUiOp(value.op);
    case 'result':
      return (
        hasKeys(value, ['t', 'ref', 'ok', 'status'], ['detail', 'value']) &&
        isString(value.ref) &&
        typeof value.ok === 'boolean' &&
        Number.isInteger(value.status) &&
        isOptional(value.detail, isString)
      );
    case 'ping':
    case 'pong':
      return hasKeys(value, ['t']);
    default:
      return false;
  }
}
