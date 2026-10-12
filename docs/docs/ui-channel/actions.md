---
sidebar_position: 4
title: Actions
---

# Actions

What comes back from the page is a `UiAction`: the page pressing something a
display offered.

```json
{ "action": "approvals.decide", "display_id": "a1", "token": "…",
  "payload": { "approve": true }, "idempotency_id": "7f3c…" }
```

Only what a display offered can be pressed. A page — or anything posing as
one — cannot press what it was not shown.

## Register, offer, dispatch

```python
from pydantic import BaseModel
from reactor.ui import ActionRegistry, UiAction, UiActionContext

class Decide(BaseModel):
    approve: bool

def decide(payload: Decide, context: UiActionContext) -> dict:
    # context: principal, session, display_id, action
    return {"approved": payload.approve}

actions = ActionRegistry(secret, platform=platform)        # secret: bytes, at least 16
dispose = actions.register("approvals.decide", Decide, decide, plugin="approvals")

approval.actions = [actions.offer(session, approval.id, "approvals.decide", label="Decide")]
...
result = await actions.dispatch(principal, session, UiAction.model_validate(body))
```

- `register(name, model, handler, plugin)` — the payload's pydantic model and
  the handler, sync or async. A name is registered once; the return value
  unregisters it, and `unregister_plugin(plugin)` drops everything a plugin
  registered.
- `offer(session, display_id, action, label=...)` — an `ActionOffer` with a
  token minted for that session, that display and that action. Offering an
  action nobody registered is an `UnknownUiAction`.
- `dispatch(principal, session, request)` — checks the press, validates the
  payload, runs the handler and answers what it returned.

`principal` is whoever the host authenticated; the registry passes it to the
veto hook and the handler and never reads it. `session` is the host's too: the
press is checked against the session it arrives in, not one it names.

## Tokens

A token is an HMAC-SHA256, keyed by the registry's secret, over the tuple
`("reactor.ui/v1", session, display_id, action)`, base64url without padding.
Each part is framed by its length (8 bytes, big-endian) before its bytes, so
no two different tuples frame to the same message — `("a:b", "c")` and
`("a", "b:c")` mint different tokens. Tokens are compared in constant time.

A token minted for another session, another display or another action is
refused. Tokens are stateless: one stays valid as long as the secret does, even
after the display stopped offering it. A press that is late — the approval was
decided already — is the handler's to refuse (the
[example](/examples/ui-channel/) raises its own `UiActionError` with `409`).
Rotate the secret, or the session id, to invalidate every token at once.

## The veto: `authorize_ui_action`

Once the token checks, every enabled plugin's hook is asked:

```python
class ApprovalPlugin:
    def authorize_ui_action(self, principal, session, action) -> bool | None:
        if action.action != "approvals.decide":
            return None                       # no objection
        return requester_of(action.display_id) != principal
```

`False` vetoes; `True` or `None` has no objection. Any plugin's `False` wins,
and a hook that raises vetoes too: unlike a plugin failing to contribute, a
plugin failing to *decide* must not read as consent. The registry asks
`PluginPlatform.authorize_ui_action` when it was given the platform; without
one, there is no veto.

The hook sees the `UiAction` as it arrived — its payload not validated yet.

## Idempotency

A press carrying an `idempotency_id` already answered — for the same session,
display and action — gets the first answer; the handler runs once. A retry
that arrives while the first press still runs waits for it and gets its
answer. A press whose handler raised is forgotten, so a retry runs again.

The registry remembers `remember` ids (default `1024`). To make room it
forgets the oldest **settled** presses only: a press still running is never
evicted, since a retry of it must join it rather than run it a second time.
When every remembered press is still running, a new one is refused with
`UiActionBusy`.

A press with no `idempotency_id` runs every time.

## Errors

Every refusal is a `UiActionError` with the HTTP status a route answers with:

| Error | Status | When |
| --- | --- | --- |
| `UnknownUiAction` | 422 | no action of that name is registered — never turned into anything else, a chat message least of all |
| `UiActionTokenInvalid` | 403 | the token was not minted for this session, display and action |
| `UiActionRefused` | 403 | a plugin's `authorize_ui_action` said no, or raised |
| `UiActionPayloadInvalid` | 422 | the payload does not validate against the action's model |
| `UiActionBusy` | 429 | every remembered press is still running |

They are checked in that order: the name, the token, the veto, the payload.

The reactor ships no route: a host maps the error in its own exception handler.

```python
from fastapi.responses import JSONResponse
from reactor.ui import UiActionError

@app.exception_handler(UiActionError)
async def refused(request, error: UiActionError) -> JSONResponse:
    return JSONResponse(status_code=error.status_code, content={"error": type(error).__name__, "detail": str(error)})

@app.post("/sessions/{session}/actions")
async def press(session: str, body: UiAction, principal=Depends(current_user)):
    return await actions.dispatch(principal, session, body)
```

A host's own refusals subclass `UiActionError` with their own `status_code`
and go through the same handler.

## On the page

A renderer presses through `act`, naming the action and the payload; the host
adds the display id and the token from the offer:

```tsx
const actOn = (display: Display): UiAct => async (action) => {
  const offer = display.actions?.find((candidate) => candidate.name === action.action);
  if (!offer) return;
  // Up the ui socket (`useUiSocket`'s `act`, see WebSocket).
  return act({ ...action, display_id: display.id, token: offer.token });
};

<ReactorDisplay display={display} act={actOn(display)} />
```

Give each press an `idempotency_id` (`crypto.randomUUID()`), and a retry of it
the same one.

## Answers

A question is a display shown with `ask`, offering one action:
`reactor.answer` (`ANSWER_ACTION` on both tiers). Its payload is an `Answer`,
`{value}` — the choice pressed, the words typed, a form's values — which the
host checks against what it asked before its code is given it. Nothing else
answers a question: a message typed in the conversation is the next turn,
not an answer.

```python
from reactor.ui import ANSWER_ACTION, Answer

actions.register(ANSWER_ACTION, Answer, take_the_answer, plugin="host")
question.actions = [actions.offer(session, question.id, ANSWER_ACTION)]
channel.emit(AskOp(scope=session, id=question.id, body=question.wire()))
```
