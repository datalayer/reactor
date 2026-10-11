# reactor.ui Example — an Approval Card

The whole `reactor.ui` loop at its smallest: a Python host shows an approval
card, a React page draws it with a renderer a plugin contributed, the person
presses Approve, and the press comes back with the token the server minted
for it.

| Side | File | What it shows |
| --- | --- | --- |
| Python | `ui_channel_example/approval.py` | `@display_type` `Approval` with a page-only note and history, a `SecretStr` that never leaves the server, the `Decide` payload, and a plugin with `provide_display_types` and `authorize_ui_action` (a requester cannot decide their own request) |
| Python | `ui_channel_example/desk.py` | The host without HTTP: `ActionRegistry` (register, offer, dispatch), a `MemoryUiChannel`, and the ops a decision emits (`patch`, `append`, `state`, `window`) |
| Python | `ui_channel_example/server.py` | The desk over FastAPI, with `UiActionError` mapped to its `status_code` |
| Python | `ui_channel_example/scripted.py` | One scripted session, recorded to `fixtures/demo-ops.json` |
| TypeScript | `src/approvalPlugin.ts` | The renderer (lazy) and a `ToolBindings` entry, as Reactor contributions |
| TypeScript | `src/ApprovalCard.tsx` | The renderer: draws the fields, presses `approvals.decide` through `act` |
| TypeScript | `src/App.tsx` | `useUiChannel`, `ReactorDisplay`, the press with the offered token, a bound tool result, a display no plugin draws, and what a model is told |

## Run it

From the repository root, with the reactor installed (`pip install -e .`):

```bash
uvicorn --app-dir examples/ui-channel ui_channel_example.server:app --port 8791
```

and in another terminal:

```bash
cd examples/ui-channel && npm install && npm run dev     # http://localhost:5181
```

Request an approval with the form, then press Approve or Reject on it. Press
as `ada` on a request `ada` made and the plugin vetoes it (403); press again
on one already decided and the desk answers 409. The right-hand column is what
a model is told: no reviewer's note, no history, no comment.

## Test it

```bash
pytest examples/ui-channel/tests -q
npx vitest run examples/ui-channel/src
```

The Python test drives the round trip — display, wire, model view, token,
dispatch, and the HTTP statuses — and checks `fixtures/demo-ops.json` is still
what the desk emits. The TypeScript tests resolve the renderer and the tool
binding, replay that file through the reducer, and press Approve on a rendered
card. Both run in CI with the rest of the suite.

After changing what the desk emits, record the session again:

```bash
python examples/ui-channel/ui_channel_example/scripted.py > examples/ui-channel/fixtures/demo-ops.json
```

See [the UI channel documentation](https://reactor.datalayer.tech/ui-channel/)
for the model behind it.
