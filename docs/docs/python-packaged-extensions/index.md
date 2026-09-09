---
sidebar_position: 0
title: Python-Packaged Extensions
slug: /python-packaged-extensions/
---

# One `pip install`, both tiers

An [extension](/typescript-plugins/extensions) is the unit of delivery — *"what would I
uninstall to lose this?"*. In an application with a server, the honest answer
usually spans both sides: the view and the endpoint behind it are one
capability, and nobody wants to install them separately or discover they are at
different versions.

A `ReactorExtension` is a Python distribution carrying both. This page is the
guide to writing one; [why it is shaped this way](/python-packaged-extensions/design)
is the record of the decisions behind it, and
[shipping a container](/python-packaged-extensions/containers) is the frontend
half built the real way.

## The layout

```
reactor-extension-hello/
  pyproject.toml
  hello_extension/
    __init__.py                             # the entry point callable
    plugin.py                               # the Python plugin
  share/datalayer/reactor/extensions/hello/
    index.js                                # the built frontend, in the wheel
```

```toml
[project.entry-points."datalayer.reactor.extensions"]
hello = "hello_extension:extension"

[tool.hatch.build.targets.wheel.shared-data]
"share/datalayer/reactor/extensions/hello" = "share/datalayer/reactor/extensions/hello"
```

`share/` is borrowed from JupyterLab rather than invented: it is where the
Python packaging tools already agree non-Python data belongs.

## The entry point

It resolves to a zero-argument callable returning both halves:

```python
from reactor import (
    ExtensionManifest, FrontendExtension, FrontendPlugin, ReactorExtension,
)

def extension() -> ReactorExtension:
    return ReactorExtension(
        manifest=ExtensionManifest(name="hello", display_name="Hello", emoji="👋"),
        plugins=[(HELLO_MANIFEST, HelloPlugin())],          # the Python half
        frontend=FrontendExtension(                          # the JavaScript half
            directory=_FRONTEND,
            entry="index.js",
            api_version="v1",
            plugins=[
                FrontendPlugin(
                    name="@hello/panel",
                    display_name="Hello panel",
                    required_backend_plugins=["hello"],
                ),
            ],
        ),
    )
```

Either half may be empty. A backend-only extension declares no `frontend`; a
frontend-only one declares no `plugins`.

## Why the frontend plugin's manifest is written in Python

Because the shell must be able to **list, describe and switch off a plugin whose
JavaScript has never been fetched**. `FrontendPlugin` carries exactly what a
[lazy plugin](/typescript-plugins/lazy-loading) needs before its module: name,
presentation, dependencies, activation events, `requiredBackendPlugins`. The
`entry` is the module.

Two things follow, and both are the point:

- a plugin list is complete on the first frame, with the modules still on the
  wire;
- a plugin that is installed but *unloadable* — a refused API version, a blocked
  origin — is a state the host can **show**, rather than an absence nobody can
  explain.

## Discovering it

```python
platform = PluginPlatform()
platform.discover_extensions()      # the default group, or pass your own
platform.start()
```

`create_reactor_app` then serves two things:

| Endpoint | What it does |
| --- | --- |
| `GET /plugins/frontend-extensions` | rescans, then answers with every extension and every frontend plugin's manifest |
| `GET /reactor-extensions/{name}/{path}` | serves that extension's files out of the installed distribution |

## Installing while the server runs

This works, and it is designed for rather than accidental:

```bash
datalayer-music-example         # a host, already serving
pip install examples/extension  # while it runs
# refresh the browser
```

:::note
Use a regular `pip install`, not `pip install -e`. An editable install writes a
`.pth` file that Python only processes at interpreter startup, so an *editable*
package genuinely does need a restart. A normal install lands in `site-packages`,
which a running process can be made to re-read — which is what the rescan does.
:::


Three things break if you do it naively, and the runtime handles all three:

| Breaks | Why | What Reactor does |
| --- | --- | --- |
| `entry_points()` misses the new distribution | `importlib.metadata` caches the path finder's listing | `importlib.invalidate_caches()` before every scan |
| the new package will not import | `FileFinder` caches the `site-packages` listing | the same call clears both |
| its files 404 | `StaticFiles` mounts are fixed when the app is built | one route resolves the directory **per request**, so nothing has to be mounted |

`GET /plugins/frontend-extensions` rescans before answering, and the browser is
what calls it. **A page refresh is the whole reload mechanism** — there is no
watcher and nothing restarts. Pass `refresh=false` in a deployment that installs
extensions only at boot.

Uninstalling while running works too: the extension leaves the list and its
plugins are unregistered. Its Python modules stay imported — one process cannot
unimport, and that is documented rather than pretended away.

## The browser half

```ts
import { bootstrapExtensions, setReactorSharedModules } from '@datalayer/reactor';

setReactorSharedModules({ react: React, '@datalayer/reactor': Reactor });

const remotes = await bootstrapExtensions('http://localhost:8799');
const reactor = buildReactorFromPlugins([...bundled, ...remotes]);
```

`bootstrapExtensions` turns the server's answer into plugins. They go in the
same list as everything else, because **a remote plugin is not a second kind of
plugin** — it is a lazy plugin whose module happens to be at a URL.

An unreachable backend yields an empty list rather than throwing: a shell that
refused to start because the extension server was down would be failing for the
wrong reason.

### Shared modules

A module fetched at runtime is not in the host's bundle, so it cannot `import
'react'` and get the host's copy — it would get a *second* React, whose hooks
throw from inside a component that looks fine. So the host publishes its copies
and a remote borrows them:

```js
const { react: React } = globalThis.__DATALAYER_REACTOR__.shared;
```

Which modules must be singletons is the host's question — its design system
belongs in that list as much as React does — which is why the runtime does not
fix the set.

:::note
This is what Module Federation's `shared` does, with the machinery removed. An
extension that ships a **container** gets the machinery back — see
[Shipping a container](/python-packaged-extensions/containers) — and the browser
picks the loader from what the server says, so the two kinds coexist.
:::

### Refusing a remote

- **`apiVersion`** — an extension declaring one this host does not speak is
  refused, and the plugin stays listed with the reason rather than throwing
  during a render.
- **Origin** — a remote runs with the shell's privileges, so same-origin always
  passes and everywhere else has to be named. The backend you passed to
  `bootstrapExtensions` counts as named: `backendUrl` is written in the host's
  own source, so a server on another port in development needs no ceremony. An
  entry that server points at some *third* origin is refused like any other
  remote — the origin a host named is the server, not everywhere the server can
  point. See [Allowed origins](/typescript-plugins/allowed-origins).

## Worked examples

[`examples/extension`](https://github.com/datalayer/reactor/tree/main/examples/extension)
is a complete distribution with both halves and no build step, so the chain is
readable end to end.
[`examples/extension-federated`](https://github.com/datalayer/reactor/tree/main/examples/extension-federated)
is the same extension shipping a container — hand-written so it runs unbuilt,
with the Rsbuild project that emits the real one beside it.

## Where this carries on

- [Shipping a container](/python-packaged-extensions/containers) — the frontend
  half as a Module Federation container, built straight into the wheel, and
  hot-updated from a dev server without rebuilding it.
- [Why it is shaped this way](/python-packaged-extensions/design) — the problem
  this answers, what already pointed at the answer, and how each open question
  was decided.
