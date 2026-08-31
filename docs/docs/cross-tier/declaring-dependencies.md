---
sidebar_position: 1
title: Declaring cross-tier dependencies
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

## What is not here yet

An event fired on one tier activates plugins on that tier only; carrying
activation across the wire is [on the roadmap](/roadmap/cross-tier-activation).
