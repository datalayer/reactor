---
sidebar_position: 6
title: WebSocket
---

# One WebSocket for the ui channel

A conversation's ops go down, and what the person presses goes up, over one
WebSocket: `reactor.ui.ws` on the Python host, `@datalayer/reactor/ui/ws` on
the page, and `useUiSocket` in React. The model's own stream (AG-UI, Vercel
AI) is the host's and carries the model's text and tool calls; the ui
channel does not ride on it.

| Tier | Import | What it holds |
| --- | --- | --- |
| Python | `reactor.ui.ws` | `UiHub` (a `UiChannel`: ops numbered and kept per scope), `UiSocket` (the endpoint a host mounts) |
| TypeScript | `@datalayer/reactor/ui/ws` | `UiSocket`: hello, ordering, resume, heartbeats, presses with results |
| React | `@datalayer/reactor/ui/react` | `useUiSocket`: the ops reduced into a `UiModel`, `act`, `state` |

## The frames

Every frame is one JSON object told apart by `t`, declared in
`reactor.ui.wire` and in the committed schema (`UpFrame`, `DownFrame`). A
frame that is not one of them is refused and the connection closed with the
reason — on either side.

| Way | Frame | Says |
| --- | --- | --- |
| up, first | `{t: "hello", v: 1, token, scope, since}` | the credential (never in the URL), the conversation, the last op the page applied |
| down, first | `{t: "welcome", v: 1, scope, seq}` | the hello accepted; `seq` the scope's last op now |
| down | `{t: "op", seq, op}` | one op of the envelope, numbered one more than the last |
| up | `{t: "action", ref, action}` | a press: a `UiAction`, with its token and idempotency id |
| up | `{t: "state", ref, body}` | RFC 6902 operations on the scope's shared state |
| down | `{t: "result", ref, ok, status, detail, value}` | what came of an action or a state frame, with the HTTP status a route would answer |
| both | `{t: "ping"}`, `{t: "pong"}` | heartbeats |

## Ordering and resume

The hub numbers each scope's ops from 1, keeps the last `keep` of them, and
hands each to every connection on the scope. A hello with no `since` gets
every op kept; with `since`, the ops after it. The page applies an op once:
one it has already applied is skipped, and a gap makes it reconnect from its
last op. A resume the hub cannot serve — `since` older than what it keeps, or
past its last op — is closed with `4410`, and the page draws the
conversation again from its host.

A press carries an idempotency id (the page makes one when the caller gives
none). Waiting for its result when the connection drops, it is sent again
after the welcome with the same id, and the host's `ActionRegistry` runs it
once.

## Close codes

| Code | Why | The page |
| --- | --- | --- |
| `4400` | a frame that is not the schema's, or a first frame that is not a hello | stops |
| `4401` | the credential refused | stops |
| `4403` | the scope is not the caller's | stops |
| `4408` | no hello in time, or nothing heard for `timeout` | reconnects |
| `4410` | the resume cannot be served | stops: draw again |
| `4429` | the page's queue overflowed (backpressure) | reconnects from its last op |

## Mounting it

```python
from fastapi import FastAPI
from reactor.ui import ActionRegistry
from reactor.ui.ws import UiHub, UiSocket, UiSocketRefused, CLOSE_FORBIDDEN

hub = UiHub()                       # producers call hub.emit(op)
actions = ActionRegistry(secret)

def authenticate(token: str, scope: str):
    principal = check(token)        # raise to refuse (4401)
    if not owns(principal, scope):
        raise UiSocketRefused(CLOSE_FORBIDDEN, f"{scope} is not yours")
    return principal

async def on_action(principal, scope, action):
    return await actions.dispatch(principal, scope, action)

app = FastAPI()
app.add_api_websocket_route(
    "/ui", UiSocket(hub, authenticate=authenticate, on_action=on_action).endpoint
)
```

On the page:

```tsx
import { useUiSocket, ReactorDisplay } from '@datalayer/reactor/ui/react';

function Conversation({ scope }: { scope: string }) {
  const { model, status, act } = useUiSocket({ url: 'wss://host/ui', scope, token: getToken });
  return <>{model.order.map((id) => <ReactorDisplay key={id} display={model.displays[id]} act={act} />)}</>;
}
```

Two tabs on one conversation are two connections on one scope: each applies
every op, and each press is answered on the tab that pressed it.

## Tested on both tiers

`tests/test_ui_ws.py` drives the endpoint: ordering after the welcome, a
resume with none lost and none twice, a resume refused (`4410`), every
refusal of a first frame, a frame not the schema's closing the connection,
heartbeats and timeouts, a page too slow closed with `4429`, presses answered
with the registry's status on their own tab while the other tab sees the op,
state frames, and a real FastAPI WebSocket. It writes
`schema/reactor-ui.v1.ws-examples.json` — two connections of one page — which
`src/ui/__tests__/ws.test.ts` replays against the page's `UiSocket`, frame
for frame, beside its own tests of gaps, drops, refusals, heartbeats and two
tabs; `src/react/ui/__tests__/useUiSocket.test.tsx` covers the hook.
