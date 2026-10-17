---
sidebar_position: 5
title: AG-UI
---

# AG-UI encoding

A host whose page already reads an [AG-UI](https://docs.ag-ui.com) stream does
not need a second transport: `encode_agui(op)` turns one op into one AG-UI
event.

```bash
pip install "datalayer_reactor[agui]"     # ag-ui-protocol
```

`ag-ui-protocol` is imported when `encode_agui` is called, not when the reactor
is: a host on another transport never needs it, and calling it without the
package installed is an `ImportError` that says what to install.

```python
from reactor.ui.agui import encode_agui

class AguiChannel:                         # a UiChannel over an AG-UI event stream
    def __init__(self, send_event):
        self._send = send_event

    def emit(self, op) -> None:
        self._send(encode_agui(op))
```

## The mapping

Everything is carried under the name `reactor.ui` (`AGUI_NAME`): the activity
type of the activity events, and the name of the custom ones.

| op | AG-UI event | carries |
| --- | --- | --- |
| `show` | `ACTIVITY_SNAPSHOT` | `messageId` the display id, `content = { scope, display }`, `replace: true` |
| `patch` | `ACTIVITY_DELTA` | the operations, with `path` and `from` under `/display` |
| `append` | `ACTIVITY_DELTA` | one `add` at `/display<path>/-` |
| `state` | `STATE_DELTA` | the operations, as they are |
| `remove`, `ask`, `window`, `meta` | `CUSTOM`, name `reactor.ui` | the op whole, as JSON |

A decision in the [approval example](/examples/ui-channel/), encoded:

```python
>>> encode_agui(patch_op)
ActivityDeltaEvent(type='ACTIVITY_DELTA', message_id='laptop', activity_type='reactor.ui',
  patch=[{'op': 'replace', 'path': '/display/data/status', 'value': 'approved'}, ...])
>>> encode_agui(append_op)
ActivityDeltaEvent(..., patch=[{'op': 'add', 'path': '/display/data/history/-', 'value': 'approved by grace: ...'}])
>>> encode_agui(window_op)
CustomEvent(type='CUSTOM', name='reactor.ui', value={'v': 1, 'scope': 'demo', 'id': None, 'op': 'window', ...})
```

An activity's content is `{ scope, display }`, so a client applying the deltas
itself keeps the display where the reactor's reducer would. A page that hands
the events back to the reactor's reducer turns them into ops again: a
`CUSTOM` named `reactor.ui` carries the op unchanged.

## Decoding on the page

`AguiUiDecoder` (`@datalayer/reactor/ui`) is the encoder's twin: one per
stream, it turns the events back into ops for `applyUiOp`.

```ts
import { AguiUiDecoder, applyUiOp, emptyUiModel } from '@datalayer/reactor/ui';

const decoder = new AguiUiDecoder();
let model = emptyUiModel();
for await (const event of stream) {
  const op = decoder.decode(event);   // null: not the reactor's
  if (op) model = applyUiOp(model, op);
}
```

- `ACTIVITY_SNAPSHOT` → `show`; `ACTIVITY_DELTA` → `patch` of that display,
  its paths out from under `/display` (an `append` comes back as the `add`
  at `<path>/-` it was sent as, which the reducer applies the same way);
  `CUSTOM` named `reactor.ui` → the op it carries.
- A delta does not carry a scope: the decoder keeps the scope each display
  was shown under. A delta for a display it never saw is refused, as is an
  event of the reactor's whose content is not the shape it should be — it
  throws, it does not guess.
- `STATE_DELTA` is not decoded: a host reads the stream's state as it reads
  any.

`schema/reactor-ui.v1.agui-examples.json` holds a sequence of ops and what
`encode_agui` makes of them. `tests/test_ui_agui_examples.py` checks the
encoder still sends that; `src/ui/__tests__/agui.test.ts` decodes it and
checks the reducer ends where the ops would have taken it.

The encoder is checked against `ag-ui-protocol` 0.1 and 1.x; the patches are
plain JSON either way.
