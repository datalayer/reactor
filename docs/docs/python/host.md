---
sidebar_position: 6
title: The host
---

# A Reactor application you can install and run

[`create_reactor_app`](/python/http-api) serves a platform's management API.
That is the half a developer needs; it is not an application. Every backend
written against it goes on to do the same twenty lines — build a platform,
register plugins, mount routers — and then leaves the *frontend* to somebody
else: a second build, a second server, a hard-coded URL between them.

A **host** closes that gap.

```bash
pip install datalayer_music_example
datalayer-music-example
```

One command, both tiers, one origin. No npm, no second server, and no CORS
policy — because at deployment there are no halves.

:::note On the name
The obvious word is *shell*, and it is wrong twice over: here the shell is
already the browser-side container that mounts plugins, and in a terminal it
means something else again. This documentation has used **host** throughout for
*"the application that runs plugins"* — a host serves the management API, a host
is what `provide_cli` extends, a host decides what an octicon id draws. The
construct is named for the word the vocabulary already had.
:::

## The one you already have

Before writing a host, note that the package ships one:

```bash
pip install datalayer_reactor
reactor
```

`reactor` serves a platform with **no plugins of its own**. Everything it runs
was installed beside it: it scans the entry-point group, registers what it
finds, and serves the management API and every discovered extension's frontend.
Point it at a built interface with `--ui DIR` when you have one.

It is worth having as a product rather than as a snippet in every example,
because it is the smallest thing that demonstrates the claim — a host with
plugins compiled into it can always be accused of knowing about them. This one
has a platform, the API, and a scan:

```python
def create_base_app(*, with_ui=True, ui=None):
    app = create_reactor_host(PluginPlatform(), title="Datalayer Reactor", discover=True)
    if with_ui and ui:
        mount_reactor_ui(app, ui)
    return app
```

Write your own when the host has routers, a platform composed by hand, or an
interface of its own to ship — which is what the rest of this page is about.

## Building one

```python
from pathlib import Path
from reactor import PluginPlatform, create_reactor_host, mount_reactor_ui

def create_app():
    platform = PluginPlatform()
    register_catalog(platform)
    register_checkout(platform)

    app = create_reactor_host(platform, title="Reactor Music", discover=True)

    app.include_router(catalog_router)
    app.include_router(build_checkout_router(platform))

    # Last, and only last.
    mount_reactor_ui(app, ui_directory())
    return app
```

| | |
| --- | --- |
| `create_reactor_host(platform, …)` | the management API, plus discovery on boot |
| `mount_reactor_ui(app, directory)` | serves a built single-page interface at `/` |
| `find_ui(__file__, "music")` | locates that build, in a wheel or a checkout |
| `run_reactor_host(app, …)` / `serve(...)` | the uvicorn call and the argument parsing a console script needs |

`ui=None` serves the API alone, because a backend-for-frontend is still a host.

## Route order is the whole design

`mount_reactor_ui` adds a **catch-all**, so it goes after every router. Two
things follow, and both are the difference between a host and a static file
server:

**A client-side route survives a refresh.** `/graph` is a path this server has
never heard of. It gets `index.html`, because answering 404 would mean the
application breaks whenever somebody reloads.

**An API path is never answered with HTML.** A catch-all does not only answer
paths nobody claimed — it also answers the ones that *nearly* matched: a GET to
a POST-only endpoint, a mistyped plugin name. Those would come back as the
application, and a client expecting JSON would fail parsing HTML with no idea
why. So the mount collects the first path segment of everything already
registered and refuses to serve the interface under any of them:

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}' localhost:8799/api/catalog/nothing
# 404 application/json      ← not the app

curl -s -o /dev/null -w '%{http_code} %{content_type}' localhost:8799/graph
# 200 text/html             ← the app, as it should be
```

That scan is recursive, because `include_router` does not necessarily flatten
what it includes — so a plugin's routes can live a level down, and missing them
would be a silent failure.

## Shipping the interface

The built UI travels in the wheel under `share/datalayer/reactor/apps/<name>/`,
the same convention [an extension's frontend](/python/packaging) uses:

```toml
[tool.setuptools.data-files]
"share/datalayer/reactor/apps/music" = ["share/datalayer/reactor/apps/music/*"]

[project.scripts]
datalayer-music-example = "datalayer_music_example:main"
```

`find_ui` looks there first and falls back to the sibling `app/dist` of a source
checkout — so `pip install -e` plus `npm run build` is a working development
loop rather than a special case.

## Same origin, and what it removes

A host serves the interface from the origin that serves the API, so the frontend
should ask *its own origin* rather than a configured address:

```ts
// resolved at runtime, in the example's catalog core
const injected = typeof __REACTOR_BACKEND_URL__ !== 'undefined' ? __REACTOR_BACKEND_URL__ : undefined;
return injected || window.location.origin;
```

Development is the split case — a dev server on one port, uvicorn on another —
so the development build injects the URL and the production build does not. The
hard-coded `http://localhost:8799` that used to sit in the example was the quiet
reason it needed two servers and a CORS policy.

## Discovery on boot

`discover=True` scans the extension entry-point group before serving, so an
installed [extension](/python/packaging) is present from the *first* request
rather than only once a browser has asked. Installing one while the host runs
still works — the frontend-extensions endpoint rescans — but a host that was
restarted should not need a page load to know what it is running.
