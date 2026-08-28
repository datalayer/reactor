[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

# ⚛️ 🚀 Reactor Music Example

A monorepo music store application built on `@datalayer/reactor`. The `app` is an
empty declarative container that just mounts plugins — all the UI is contributed
by the plugins.

## Structure

```
music/
  package.json          # npm workspaces root, depends on reactor via file:../..
  app/                  # declarative container: mounts plugins, no logic
  catalog-plugin/       # BASE plugin: frontend catalog + FastAPI backend (songs)
  header-plugin/        # depends on catalog-plugin + shop-plugin + checkout-plugin
  shop-plugin/          # depends on catalog-plugin, owns the shared cart store
  checkout-plugin/      # depends on shop-plugin, owns the checkout button + page
  playlist-plugin/      # OFFERS an extension point; ships no rules of its own
  mood-plugin/          # USES the playlist's extension point; renders nothing
  plugins-panel-plugin/ # checkboxes: switch plugins off and on while it runs
  backend/              # the host that runs every Python plugin on one platform
```

The Python backends are real installable packages (each with its own
`pyproject.toml`):

```
catalog-plugin/     # music-catalog-plugin  -> catalog_plugin package
checkout-plugin/    # music-checkout-plugin -> checkout_plugin package
playlist-plugin/    # music-playlist-plugin -> playlist_plugin package
mood-plugin/        # music-mood-plugin     -> mood_plugin package
backend/            # music-backend         -> music_backend package (the host)
```

- **catalog-plugin** — the base plugin. Exposes the `useCatalogSongs` data hook
  and a `catalog` slot UI. Ships the `music-catalog-plugin` Python package
  (`catalog-plugin/`, import `catalog_plugin`) — a reactor plugin
  (`CatalogPlugin`, manifest name `catalog`) serving `GET /api/catalog/songs`.
- **header-plugin** — declares
  `dependencies: [CatalogExtension, ShopExtension, CheckoutExtension]` and
  consumes `useCatalogSongs` plus the shared cart store. Contributes the store
  header (with the theme / color-mode chooser at the top right) to the `header`
  slot, including a cart summary that reveals cart details — plus the checkout
  plugin's Checkout button — in a Primer overlay on hover.
- **shop-plugin** — declares `dependencies: [CatalogExtension]` and consumes
  `useCatalogSongs`. Owns the shared `useCart` store and contributes the
  purchasable song cards + cart to the `main` slot.
- **checkout-plugin** — declares `dependencies: [ShopExtension]` and consumes the
  shared cart store. Provides the `CheckoutButton` (rendered by the header plugin
  inside its cart overlay) and contributes the `CheckoutPage` to the `checkout`
  slot. Opening checkout replaces the main store view with the checkout page;
  placing an order clears the cart. Ships the `music-checkout-plugin` Python
  package (`checkout-plugin/`, import `checkout_plugin`) — a reactor
  plugin (`CheckoutPlugin`, manifest name `checkout`) that both **imports** the
  `catalog_plugin` package to price the cart and declares a reactor
  `dependencies=["catalog"]`, so the reactor refuses to register it unless the
  catalog plugin is registered first. Serves `POST /api/checkout`.
- **playlist-plugin** — the plugin that **offers an extension point**. It owns a
  playlist view and opens `music.playlistRule` for other plugins to fill; it
  ships no rules itself, so on its own it renders a playlist that says so. Its
  `music-playlist-plugin` Python package (`playlist_plugin`, manifest name
  `playlist`) does the same on the server: it defines the
  `music.playlist.rule` point and serves `GET /api/playlist/rules` and
  `GET /api/playlist?rule=…` from whatever is contributed to it.
- **mood-plugin** — the plugin that **uses** that extension point. It declares
  `dependencies: [PlaylistExtension]` and contributes three rules (Chill,
  Energetic, A to Z); it contributes to no slot and renders nothing of its own.
  Its `music-mood-plugin` Python package (`mood_plugin`, manifest name `mood`,
  reactor `dependencies=["playlist"]`) contributes the same three rules to the
  server-side point from `provide_contributions`. The direction of the
  dependency is the lesson: the playlist plugin never imports the mood plugin,
  does not know it exists, and works without it.
- **plugins-panel-plugin** — contributes the **Plugins** panel to the `plugins`
  slot: a checkbox per plugin, for both tiers. Frontend plugins are toggled with
  `reactor.enable` / `reactor.disable` in the browser; backend plugins through
  the reactor's own management API (`GET /plugins`,
  `POST /plugins/{name}/toggle`). It owns the `useBackendPlugins` store and the
  `useBackendPluginAvailability` hook the app passes to `useReactor`, so a slot
  gated on `requiredBackendPlugins` disappears when its backend plugin is
  switched off. The panel never lists itself: a panel that can switch itself off
  cannot switch itself back on.
- **backend** — the host application for the Python side. Plugin packages ship
  their own standalone `create_app`; this package is what runs them *together*,
  in dependency order, on one `PluginPlatform` — which is the platform the
  Plugins panel talks to.
- **app** — mounts `HeaderExtension`, `ShopExtension`, `MoodExtension` and
  `PluginsPanelExtension`; the catalog, checkout and playlist plugins are pulled
  in transitively as dependencies. The app swaps the main store view for the
  `checkout` slot while checkout is open.

## Run

The app depends on `@datalayer/reactor` via `file:../..`, which resolves to the
built `dist/`, so reactor must be built first.

```bash
# from the reactor repo root
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

# 3. Start the backend host (every Python plugin, one platform) on port 8799
uvicorn music_backend.app:app --reload --port 8799

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

## Two plugins, one extension point

`playlist-plugin` and `mood-plugin` exist to show the shape that a slot cannot
express. A **slot** answers "render everything plugins put here". An **extension
point** answers a different question: "what do plugins *offer*, so the
application can choose?" — here, a set of ways to fill a playlist, of which one
is on screen at a time.

- The playlist plugin **declares** the point and hosts it. It reads the
  contributions with `useContributions(PlaylistRuleExtension)`, draws a chooser
  from them, and applies the chosen rule to the catalog.
- The mood plugin **contributes** to it, declaratively:

  ```ts
  contributes: [
    contribution(PlaylistRuleExtension, CHILL, { id: 'chill', order: 0 }),
    …
  ]
  ```

Nothing points from the playlist plugin to the mood plugin. That is what makes
this an extension point rather than an import: a fourth plugin can add a rule
tomorrow without the playlist plugin changing.

The same relationship exists on the Python side, between the `playlist` and
`mood` backend plugins, over `music.playlist.rule`.

## Switching plugins off and on

The **Plugins** panel at the top of the page has a checkbox per plugin. Both
kinds are live — nothing restarts, and no page reloads:

| Uncheck | What happens | Why |
| --- | --- | --- |
| `@music/mood` (frontend) | the playlist's chooser empties | disabling an extension withdraws its contributions, so the rules leave the point |
| `@music/playlist` (frontend) | the playlist card disappears | its slot component goes with it, while mood's contributions sit unused |
| `catalog` (Python) | catalog **and** shop disappear | both React extensions declare `requiredBackendPlugins: ['catalog']` |
| `mood` (Python) | `GET /api/playlist/rules` returns `[]` | the platform stops counting a disabled plugin's contributions |

The backend half is worth trying with `curl` too, to see that the server really
changed its mind rather than the browser hiding something:

```bash
curl -s localhost:8799/api/playlist/rules            # chill, energetic, a-to-z
curl -s localhost:8799/plugins/mood/toggle \
  -H 'content-type: application/json' -d '{"enabled": false}'
curl -s localhost:8799/api/playlist/rules            # []
```
