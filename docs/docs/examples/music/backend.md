---
sidebar_position: 4
title: The Python backend
---

# Four packages, one platform, one command

A plugin platform is composed by an application, not by its plugins. Each plugin
package in `examples/music` ships its own standalone `create_app` for running it
alone; `datalayer_music_example` is the host that runs them *together*, in dependency
order, on one `PluginPlatform` — which is what the frontend's Plugins panel talks
to.

`datalayer_music_example` is a real distribution — it depends on the four plugin
packages, ships the built interface in its wheel, and exposes a console script:

```bash
pip install datalayer_music_example
datalayer-music-example
```

See [the host](/python/host) for the construct that makes that one command
serve both tiers.

```python
def create_app() -> FastAPI:
    reactor = PluginPlatform()
    register_catalog(reactor)
    register_checkout(reactor)
    register_playlist(reactor)
    register_mood(reactor)
    reactor.start()

    app = create_reactor_app(reactor)
    app.include_router(catalog_router)
    app.include_router(build_checkout_router(reactor))
    # Built from the platform rather than imported: the playlist routes read
    # their rules per request, so toggling `mood` changes the answer live.
    app.include_router(build_playlist_router(reactor))
    return app
```

Registration order **is** the dependency order the platform enforces: it refuses
a plugin whose declared dependencies are not registered yet, so `checkout` and
`playlist` follow `catalog`, and `mood` follows `playlist`.

## The four manifests

| Plugin | Depends on | Declares about the frontend | Serves |
| --- | --- | --- | --- |
| `catalog` | — | — | `GET /api/catalog/songs` |
| `checkout` | `catalog` | requires `@music/checkout` | `POST /api/checkout` |
| `playlist` | `catalog` | likes `@music/playlist` | `GET /api/playlist/rules`, `GET /api/playlist?rule=…` |
| `mood` | `playlist` | likes `@music/mood` | nothing — it contributes rules |

`checkout` declares its frontend dependency as **required** because the endpoint
it serves is only ever called by the checkout UI: a backend without it is
reachable but unused. `playlist` and `mood` declare theirs as **optional** —
those routes answer `curl` perfectly well on their own.

Ask the server what is missing:

```bash
curl -s 'localhost:8799/plugins/frontend-requirements?active=@music/playlist'
```

## The pair, again — on the server

`playlist` defines the `music.playlistRule` contribution point and serves
whatever is contributed to it. `mood` contributes three rules from
`provide_contributions` and serves nothing.

The playlist plugin never imports the mood plugin, does not know it exists, and
works without it — the same lesson as
[on the frontend](/examples/music/architecture), in a different language.

## Each package alone

Every plugin package also builds a standalone app, which is the honest test that
a plugin is a plugin rather than a module of the host:

```bash
uvicorn catalog_plugin.app:app --reload --port 8799
```
