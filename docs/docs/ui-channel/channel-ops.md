---
sidebar_position: 3
title: Channel ops and the reducer
---

# Channel ops and the reducer

## The envelope

Every op is `{ "v": 1, "op", "scope", "id", "body" }`, and `op` decides the
shape of the rest:

| op | `id` | body | does |
| --- | --- | --- | --- |
| `show` | the display's | a display | shows it, or replaces the one of the same id |
| `patch` | required | RFC 6902 operations | changes one display (`/text`, `/data/...`, `/actions`) |
| `append` | required | `{ path, value }` | pushes `value` onto the array at `path` in one display |
| `remove` | required | none | removes one display |
| `state` | — | RFC 6902 operations | changes the scope's shared state |
| `ask` | the display's | a display | shows a question, remembered as waiting |
| `window` | — | `{ name, args }` | a message for the host window: open, focus, notify — not state |
| `meta` | — | an object | merges facts about the scope (a title, an author) |

`v` is the wire version (`UI_WIRE_VERSION`, `1`); a change to the wire is a
new one. `scope` is what an op belongs to — a session, a thread — so one stream
can carry several.

In Python each op is a pydantic model (`ShowOp`, `PatchOp`, … — `UiOp` is
their union, told apart by `op`), and each patch operation is one of
`PatchAdd`, `PatchRemove`, `PatchReplace`, `PatchMove`, `PatchCopy`,
`PatchTest` (`PatchOperation`), each with exactly the members its `op` needs:
`value` for `add`, `replace` and `test` (where `null` is a value, and a missing
`value` is refused), `from` for `move` and `copy`, nothing else for `remove`.

## Emitting: `UiChannel`

A producer only ever calls `emit(op)`. The reactor does not say how ops reach
the page — a websocket, a server-sent event per op, an AG-UI stream, a poll —
the host implements `UiChannel` over its transport:

```python
from reactor.ui import UiChannel, UiOp, parse_op

class WebSocketChannel:          # a UiChannel: anything with emit(op)
    def __init__(self, send):
        self._send = send

    def emit(self, op: UiOp) -> None:
        self._send(parse_op(op).model_dump(mode="json", by_alias=True))
```

`by_alias=True` matters: a `move` or `copy` operation's `from` is `from_` in
Python. `parse_op(dict)` validates an op from its JSON form; an op passes
through.

`MemoryUiChannel` keeps every op, in order — for tests, and for a host that
replays a session:

```python
from reactor.ui import MemoryUiChannel
from reactor.ui import channel as ui

channel = MemoryUiChannel()
ui.show(channel, "s1", approval)
ui.patch(channel, "s1", approval.id, [{"op": "replace", "path": "/data/status", "value": "approved"}])
ui.append(channel, "s1", approval.id, "/data/history", "approved by grace")
ui.state(channel, "s1", [{"op": "add", "path": "/last_decision", "value": approval.id}])
ui.window(channel, "s1", "notify", message="Laptop approved")
ui.meta(channel, "s1", title="Approvals")

channel.for_scope("s1")   # the ops, as models
channel.dump()            # the ops as JSON, as a transport would send them
```

There is a helper per op — `show`, `ask`, `patch`, `append`, `remove`,
`state`, `window`, `meta` — and each validates what it is given before it
emits.

## Keeping: the reducer

On the page, `applyUiOp(model, op)` returns the model after one op and never
touches the one it was given, so a React reducer, a store or a test can hold
it:

```ts
import { applyUiOps, emptyUiModel, orderedDisplays } from '@datalayer/reactor/ui';

const model = applyUiOps(emptyUiModel(), ops);
model.displays;         // by id
orderedDisplays(model); // in the order they were first shown
model.asks;             // ids shown by `ask`, still waiting
model.state;            // as `state` ops patched it (starts as {})
model.meta;             // as `meta` ops merged it
```

| op | in the model |
| --- | --- |
| `show` | sets `displays[id]`; a new id goes to the end of `order`, a known one keeps its place |
| `ask` | the same, and adds the id to `asks` |
| `patch` | RFC 6902 on the display; the id stays the display's |
| `append` | an `add` at `<path>/-` on the display |
| `remove` | drops it from `displays`, `order` and `asks`; an unknown id changes nothing |
| `state` | RFC 6902 on `state` |
| `meta` | a shallow merge into `meta` |
| `window` | nothing — the same model comes back |

An `ask` stays in `asks` until a `remove` for its id: answering it is the
host's business.

`useUiChannel` keeps the model in a component. The transport calls `emit` with
each op it receives (one, or a list in order); with a `scope`, ops of other
scopes are ignored; `window` ops go to `onWindow`:

```tsx
import { ReactorDisplay, useUiChannel } from '@datalayer/reactor/ui/react';
import { isUiOp, orderedDisplays } from '@datalayer/reactor/ui';

const { model, emit, reset } = useUiChannel({ scope: sessionId, onWindow: (op) => notify(op.body) });
useEffect(() => stream.on('reactor.ui', (value) => isUiOp(value) && emit(value)), [stream, emit]);
return orderedDisplays(model).map((d) => <ReactorDisplay key={d.id} display={d} act={actOn(d)} />);
```

`emit` keeps its identity across renders, even when `onWindow` is a fresh
function each render.

### Checking what arrives

`isUiOp(value)` checks a value from the network before the reducer sees it:
the wire version, a string `scope`, and the `id` and `body` its `op` needs — a
display for `show` and `ask`, a string `id` and valid operations for `patch`, a
`path` for `append`, no body for `remove`, a `name` (and an object `args`) for
`window`, an object for `meta`. `isDisplay` and `isPatchOperation` check the
parts.

### Fails fast

The reducer throws rather than leave the page drawing something the server did
not say:

- an op of another wire version;
- a `patch` or `append` for a display that was never shown;
- an op it does not know;
- any patch operation that cannot apply (below).

A patch applies as a whole or not at all: the model handed in is unchanged
when one of its operations throws.

## The JSON Patch rules

`applyPatch(document, operations)` is RFC 6902 on a copy — values added are
copied too, so the model never shares an object with an op:

- **Pointers** (RFC 6901): `""` is the whole document; anything else starts
  with `/`; `~1` reads as `/` and `~0` as `~`.
- **`add`** sets an object member, or inserts into an array at an index
  (`0` … length) or at `-`, the end.
- **`remove`** and **`replace`** need the value to be there: a missing member
  or an index past the end throws.
- **`move`** is a remove at `from`, then an add at `path`; **`copy`** adds a
  copy of the value at `from`. Both need `from`.
- **`test`** compares as JSON: arrays in order, objects by their keys whatever
  their order. A failed `test` throws, and the patch does not apply.
- **Array indexes** are digits with no leading zero (`0`, `12`, not `01`, not
  `-1`); `-` is an index only for `add`.

### Pointer safety

A pointer comes from the server, and the reducer runs on the page; it can never
lead out of the document:

- `__proto__`, `constructor` and `prototype` are never path tokens — a pointer
  with one throws, so `/data/__proto__/polluted` cannot reach
  `Object.prototype`.
- Pointers walk own properties only: `/data/toString` is "no value", not the
  function every object inherits.

## Next

- [Actions](/ui-channel/actions) — what comes back from the page.
- [AG-UI](/ui-channel/agui) — the same ops on an AG-UI stream.
