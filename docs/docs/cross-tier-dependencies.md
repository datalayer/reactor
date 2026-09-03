---
sidebar_position: 6
title: Cross-tier Dependencies
---

# Declaring what a plugin needs from the other tier

A plugin usually has a counterpart across the wire, and there are two strengths
of that relationship: one it cannot work without, and one it does more with.
Both are declared rather than discovered, so a host can draw the relationship
before anything has loaded.

## Frontend → backend

A **required** backend plugin gates rendering: while it is absent or switched
off, the plugin's slot components do not render. An **optional** one never gates
anything — reacting to it is the plugin's own job.

```ts
definePlugin({
  name: '@app/notebook',
  requiredBackendPlugins: ['kernels'],   // no kernels, no notebook
  optionalBackendPlugins: ['search'],    // nicer with it, fine without
});
```

```tsx
function NotebookToolbar() {
  // A required plugin is guaranteed by the time this runs. An optional one
  // is a question, and this is how it is asked.
  const canSearch = useBackendPlugin('search');
  return canSearch ? <SearchButton /> : null;
}
```

The predicate that answers "is this backend plugin available?" is the
application's to supply, because only the application knows where its server is:

```tsx
useReactor(reactor, { isBackendPluginAvailable });
```

## Backend → frontend

The mirror image, on the `PluginManifest`:

```python
PluginManifest(
    name="checkout",
    version="1.0.0",
    frontend_dependencies=["@app/checkout"],           # required
    optional_frontend_dependencies=["@app/header"],    # nice to have
)
```

## Declared, not enforced — and why

Backend `dependencies` are checked at registration and refused outright. A
frontend dependency cannot be: the plugins live in a browser the platform cannot
see, and a backend that refused to start because nobody had opened a page yet
would be refusing for the wrong reason.

So the platform answers for a caller that *can* see both sides:

```python
platform.frontend_requirements(["@app/checkout"])
# {"checkout": {"required": ["@app/checkout"], "optional": ["@app/header"],
#               "missing_required": [], "missing_optional": ["@app/header"]}}
```

The same answer is served at `GET /plugins/frontend-requirements?active=…`, which
is how a frontend asks *"is anything the server needs missing from what I
loaded?"*.

## Seeing it work

In the [music example](/examples/music/switching-plugins), unchecking the Python
`catalog` plugin empties the store — both React plugins declare
`requiredBackendPlugins: ['catalog']` — while unchecking `playlist` leaves its
card exactly as useful, because the frontend declared that one optional.

## Activation follows, not just rendering

`requiredBackendPlugins` gates *rendering*: a slot component whose backend
plugin is switched off does not draw. On its own that leaves the plugin
**activated**, holding contributions backed by a server that is no longer
answering — the plugin list says it is on while nothing it offers works.

`setBackendPlugins` closes that:

```ts
await reactor.setBackendPlugins(['catalog', 'playlist']);
// → { deactivated: ['@app/shop', '@app/catalog'], activated: [] }
```

A plugin whose required backend plugin goes away is stood down, dependants
first; when it returns, so is the plugin. What crosses the wire is
**deactivation, never disabling** — a server must not be able to undo somebody's
checkbox, so a plugin a person switched off stays off.

In React, one line wires it to a running server:

```tsx
useBackendPluginStream('http://localhost:8799');
```

It reads `GET /plugins/state` and follows `GET /events/stream`. Two properties
worth knowing, both deliberate:

- **A dropped connection is not a server saying no.** The last known state is
  kept and nothing is torn down because the network blinked — the same reason a
  backend does not refuse to start when no browser has loaded yet.
- **Polling is correct.** The stream is an optimisation over the state endpoint,
  and the fallback is the same code path with a timer, so a deployment that
  cannot hold a connection open loses latency and nothing else.

Direction matters, and only one way propagates: server → browser. A browser
closing a view is not a reason to stand a plugin down for every other browser
the server is serving.
