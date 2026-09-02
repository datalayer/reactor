---
sidebar_position: 0
title: Music store
slug: /examples/music/
---

# 🎵 The music store example

A monorepo music store built on `@datalayer/reactor`. The `app` is an empty
declarative container that just mounts plugins — all the UI is contributed by
the plugins.

> **[Run it on this site →](/examples/music/demo)** — the store, the Plugins
> panel, and both tiers of switches, in the page.

## Structure

```
music/
  package.json          # npm workspaces root, depends on reactor via file:../..
  app/                  # declarative container: mounts plugins, no logic
  catalog-plugin/       # BASE plugin: frontend catalog + FastAPI backend (songs)
  header-plugin/        # depends on catalog-plugin + shop-plugin
  shop-plugin/          # depends on catalog-plugin, owns the shared cart store
  checkout-plugin/      # depends on shop-plugin, owns the checkout button + page
  playlist-plugin/      # OFFERS a contribution point; ships no rules of its own
  mood-plugin/          # USES the playlist's contribution point; renders nothing
  plugins-panel-plugin/ # the Python plugins, switchable from the browser
  backend/              # the host that runs every Python plugin on one platform
```

The Python backends are real installable packages, each with its own
`pyproject.toml`:

| Directory | Distribution | Import |
| --- | --- | --- |
| `catalog-plugin/` | `music-catalog-plugin` | `catalog_plugin` |
| `checkout-plugin/` | `music-checkout-plugin` | `checkout_plugin` |
| `playlist-plugin/` | `music-playlist-plugin` | `playlist_plugin` |
| `mood-plugin/` | `music-mood-plugin` | `mood_plugin` |
| `backend/` | `datalayer_music_example` | `datalayer_music_example` (the host **and** the `datalayer-music-example` command) |

## Run it

```bash
# from the reactor repository root
make music-app          # build the interface, install every plugin
datalayer-music-example # one server: the store, its API, and all four Python plugins
```

That is the whole thing — no npm afterwards, no second server, no CORS. The
Python host serves the built interface from the same origin as the API it calls.
See [the host](/python/host) for what makes that one command possible.

## Run it the long way

Which is what a *developer* does, because the frontend needs a dev server:

```bash
# from the reactor repository root
make music
```

Or manually:

```bash
# 1. Build reactor
npm run build

# 2. Install the backend packages (editable), in dependency order.
pip install -e examples/music/catalog-plugin \
              -e examples/music/checkout-plugin \
              -e examples/music/playlist-plugin \
              -e examples/music/mood-plugin \
              -e examples/music/backend

# 3. Start the host on port 8799
uvicorn datalayer_music_example.app:app --reload --port 8799

# 4. Install workspaces and start the app (port 5179)
cd examples/music
npm install
npm run dev
```

The checkout endpoint prices a cart against the catalog:

```bash
curl -s localhost:8799/api/checkout \
  -H 'content-type: application/json' \
  -d '{"items":[{"id":"s1","quantity":2},{"id":"s3"}]}'
```

## Commands

Press **Ctrl-K**. The palette lists what the store's plugins have registered —
*Clear the cart*, *Open checkout* — and greys out the ones that cannot run right
now, so *Clear the cart* is unavailable while the cart is empty.

The commands are declared on the plugins that own the state they change; the
[palette](/plugins/commands) shows them without either knowing about the other.
The catalog's Python package registers commands too, reachable from a terminal:

```bash
reactor commands list
reactor catalog songs
```

See [the command registry](/cross-tier/commands) and
[extending the command line](/python/cli).

## Read on

| Page | What it covers |
| --- | --- |
| [Live demo](/examples/music/demo) | the store, running here |
| [Architecture](/examples/music/architecture) | every plugin, what it depends on, and why |
| [Switching plugins off](/examples/music/switching-plugins) | what each checkbox does, and what it proves |
| [The Python backend](/examples/music/backend) | four packages, one platform, in dependency order |
