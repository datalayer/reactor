---
sidebar_position: 7
title: Security
---

# Security

Two boundaries matter: what the server lets reach a model, and what it accepts
from the page. `reactor.ui` draws both in one place each, so a feature does not
have to remember them.

## What never reaches a model

A model is told about a display through `display.model_view()` — its type, its
`text()`, and its `both` fields — and about a press through
`model_view(payload)`. Nothing else is filtered for it.

- **Page-only fields** (`Annotated[..., audience("page")]`) are drawn for the
  person and left out of `model_view`: a reviewer's note, a comment typed with
  a decision, a field holding personal data the model has no need for.
- **Secrets** (`SecretStr`, `SecretBytes`, optional or not) leave the server in
  neither view: not on the wire, not to a model. A secret nested in a list or a
  dict whose annotation did not name it is sent as `null`. A secret typed on the
  page reaches its action handler and nothing else.
- **Nested models** are filtered by their own fields' audiences, all the way
  down.

What this does not cover, and the host must:

- **`text()` is for both.** It is in the model view; a page-only value
  formatted into it is a page-only value told to the model.
- **The wire is not the model view.** Hand a model `model_view()`, never
  `wire()` or an op: the wire carries the page-only fields, and the action
  tokens.
- **Audiences are declared, not inferred.** A field with no audience is for
  both.

## What the page may send

The page sends one thing back: a `UiAction`, and the registry accepts it only
when every check passes, in this order:

1. **A registered action** — an unknown name is `UnknownUiAction` (422), never
   reinterpreted as something else.
2. **A token minted for this session, this display and this action** — an
   HMAC the page cannot compute, compared in constant time
   (`UiActionTokenInvalid`, 403). The session is the one the host
   authenticated the request into, not one the page names.
3. **No plugin's veto** — `authorize_ui_action` answering `False`, or raising,
   refuses it (`UiActionRefused`, 403). Refusals fail closed.
4. **A payload of the action's model** — validated by pydantic before the
   handler sees it (`UiActionPayloadInvalid`, 422).

The wire models are strict on the way in: a member nobody declared is refused,
not carried along.

What the host keeps:

- **The secret.** At least 16 bytes, kept as a signing key is kept. Rotating it
  invalidates every token at once.
- **Tokens do not expire** and are not single-use: a token stays valid while
  the secret does, even once the display no longer offers it. A handler whose
  action can be pressed once checks its own state (the
  [example](/examples/ui-channel/) answers `409` when an approval was decided
  already). An `idempotency_id` makes a retry safe; it is not a nonce.
- **The principal.** The registry passes it to the veto hook and the handler
  and never reads it: who pressed is what the host's authentication says.
- **The veto sees the raw payload.** `authorize_ui_action` runs before the
  payload is validated; a hook that reads the payload must treat it as
  untrusted.
- **Busy is a refusal.** When every remembered press is still running, a new
  one with an idempotency id is `UiActionBusy` (429) rather than an eviction
  that would let a retry of a running press run twice.

## What the page accepts

The page is a reader of the server, and still checks what arrives:

- **`isUiOp`** before the reducer: the wire version, and the `id` and `body`
  each op needs.
- **Pointers** cannot leave the document: `__proto__`, `constructor` and
  `prototype` are never path tokens, and only own properties are walked, so a
  patch cannot pollute `Object.prototype` or read an inherited member.
- **The reducer fails fast** on what it cannot apply, and a failed patch
  leaves the model as it was.
- **Renderers** are drawn from contributions of enabled plugins only, and
  every plugin draws its own types; a display no renderer claims is drawn as
  its text — as text, not markup.
