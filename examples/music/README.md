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
  playlist-plugin/      # OFFERS an contribution point; ships no rules of its own
  mood-plugin/          # USES the playlist's contribution point; renders nothing
  plugins-panel-plugin/ # checkboxes: switch plugins off and on while it runs
  catalog-core/         # the data contract, with no design system in it
  backend/              # datalayer_music_example: the host, and the console script
```

The Python backends are real installable packages (each with its own
`pyproject.toml`):

```
catalog-plugin/     # music-catalog-plugin  -> catalog_plugin package
checkout-plugin/    # music-checkout-plugin -> checkout_plugin package
playlist-plugin/    # music-playlist-plugin -> playlist_plugin package
mood-plugin/        # music-mood-plugin     -> mood_plugin package
backend/            # datalayer_music_example -> the host, and the console script
```

- **catalog-plugin** — the base plugin. Exposes the `useCatalogSongs` data hook
  and a `catalog` slot UI. Ships the `music-catalog-plugin` Python package
  (`catalog-plugin/`, import `catalog_plugin`) — a reactor plugin
  (`CatalogPlugin`, manifest name `catalog`) serving `GET /api/catalog/songs`.
- **header-plugin** — declares `dependencies: [CatalogPlugin, ShopPlugin]` and
  consumes `useCatalogSongs` plus the shared cart store. Contributes the store
  header (with the theme / color-mode chooser at the top right) to the `header`
  slot, including a cart summary that reveals cart details in a Primer overlay
  on hover. It *offers* a `cart-actions` slot inside that overlay and does not
  know or care who fills it — which is why it no longer depends on the checkout
  plugin.
- **shop-plugin** — declares `dependencies: [CatalogPlugin]` and consumes
  `useCatalogSongs`. Owns the shared `useCart` store and contributes the
  purchasable song cards + cart to the `main` slot, offering the same
  `cart-actions` slot underneath them.
- **checkout-plugin** — declares `dependencies: [ShopPlugin]` and consumes the
  shared cart store. Contributes everything it owns, and exports nothing for
  another plugin to draw: the `CheckoutButton` to `cart-actions`, the
  `CheckoutPage` to `checkout`, and a `CheckoutAside` to `checkout-aside` which
  shows a different emoji for each of the plugin's two views — 🛒 while the cart
  is being reviewed, 📦 once the order is placed. Two slots for the page rather
  than one component drawing both columns: the application decides the layout,
  the plugin decides what goes in it, and the app never learns that "order
  confirmed" is one of the states this plugin can be in. Opening checkout
  replaces the main store view with those two columns; placing an order clears
  the cart.

  **This is the plugin to untick first.** The header used to `import` the
  checkout button and render it itself, so switching this plugin off left a
  button that opened a page that was no longer there. Now the header and the
  shop each offer a `cart-actions` slot and this plugin fills both, so unticking
  it removes the button from the overlay *and* from under the songs, and the
  rest of the store carries on. Nothing depends on it any more, which is why the
  app mounts it deliberately in `StoreExtension` — a capability of the store,
  not an implementation detail of its header. Ships the `music-checkout-plugin` Python
  package (`checkout-plugin/`, import `checkout_plugin`) — a reactor
  plugin (`CheckoutPlugin`, manifest name `checkout`) that both **imports** the
  `catalog_plugin` package to price the cart and declares a reactor
  `dependencies=["catalog"]`, so the reactor refuses to register it unless the
  catalog plugin is registered first. Serves `POST /api/checkout`.
- **playlist-plugin** — the plugin that **offers an contribution point**. It owns a
  playlist view and opens `music.playlistRule` for other plugins to fill; it
  ships no rules itself, so on its own it renders a playlist that says so. Its
  `music-playlist-plugin` Python package (`playlist_plugin`, manifest name
  `playlist`) does the same on the server: it defines the
  `music.playlistRule` point and serves `GET /api/playlist/rules` and
  `GET /api/playlist?rule=…` from whatever is contributed to it.
- **mood-plugin** — the plugin that **uses** that contribution point. It declares
  `dependencies: [PlaylistPlugin]` and contributes three rules (Chill,
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
- Every plugin, both tiers, declares a `displayName`/`display_name`,
  `description`, `octicon` and `emoji`. The Python `checkout` plugin also
  declares `frontend_dependencies=["@music/checkout"]` — the endpoint it serves
  is only ever called by the checkout UI — while `playlist` and `mood` declare
  theirs as optional. Ask the server what is missing with
  `GET /plugins/frontend-requirements?active=…`.
- **backend** — the host application for the Python side. Plugin packages ship
  their own standalone `create_app`; this package is what runs them *together*,
  in dependency order, on one `PluginPlatform` — which is the platform the
  Plugins panel talks to.
- **app** — mounts `HeaderPlugin`, `ShopPlugin`, `MoodPlugin` and
  `PluginsPanelPlugin`; the catalog, checkout and playlist plugins are pulled
  in transitively as dependencies. The app swaps the main store view for the
  `checkout` slot while checkout is open.

## Run

```bash
# from the reactor repository root
make music-app          # build the interface, install every plugin
datalayer-music-example # one server: the store, its API, and all four Python plugins
```

One command, both tiers, one origin — no npm afterwards, no second server, no
CORS. `datalayer_music_example` is a real distribution: it depends on the four
plugin packages, ships the built interface in its wheel, and exposes the console
script. See `backend/` and the [host documentation](https://reactor.datalayer.tech/python/host).

## Run it the long way

Which is what a developer does, because the frontend wants a dev server:

```bash
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

## Loaded after the first paint

`@music/mood` is mounted with `defineLazyPlugin`, so its module is fetched
*after* the platform starts rather than before the first paint:

```ts
const MoodPlugin = defineLazyPlugin({
  name: '@music/mood',
  displayName: 'Moods',
  octicon: 'sun',
  emoji: '🌤️',
  dependencies: [PlaylistPlugin],
  load: () => import('@datalayer-examples/reactor-music-mood-plugin')
    .then(module => module.MoodPlugin),
});
```

The store and an empty playlist render immediately; the module lands, and the
rule chooser fills in. It is a fair candidate precisely because it renders no UI
of its own — its absence costs a chooser, not a page.

Everything the sidebar needs to list and describe it is declared on the
reference rather than inside the module, so it appears in the plugin list from
the first frame with a `loading…` marker rather than popping into existence when
its module arrives.

## Two plugins, one contribution point

`playlist-plugin` and `mood-plugin` exist to show the shape that a slot cannot
express. A **slot** answers "render everything plugins put here". An **extension
point** answers a different question: "what do plugins *offer*, so the
application can choose?" — here, a set of ways to fill a playlist, of which one
is on screen at a time.

- The playlist plugin **declares** the point and hosts it. It reads the
  contributions with `useContributions(PlaylistRulePoint)`, draws a chooser
  from them, and applies the chosen rule to the catalog.
- The mood plugin **contributes** to it, declaratively:

  ```ts
  contributes: [
    contribution(PlaylistRulePoint, CHILL, { id: 'chill', order: 0 }),
    …
  ]
  ```

Nothing points from the playlist plugin to the mood plugin. That is what makes
this an contribution point rather than an import: a fourth plugin can add a rule
tomorrow without the playlist plugin changing.

The same relationship exists on the Python side, between the `playlist` and
`mood` backend plugins, over `music.playlistRule`.

## Switching plugins off and on

The **Plugins** sidebar on the right has a checkbox per plugin, frontend and
backend alike. Both kinds are live — nothing restarts, and no page reloads:

| Uncheck | What happens | Why |
| --- | --- | --- |
| `@music/mood` (frontend) | the playlist's chooser empties | disabling a plugin withdraws its contributions, so the rules leave the point |
| `@music/checkout` (frontend) | both Checkout buttons go, and the page with them | nothing draws them but the checkout plugin — the header and the shop only offer the slot |
| `@music/playlist` (frontend) | the playlist card disappears | its slot component goes with it, while mood's contributions sit unused |
| `catalog` (Python) | catalog **and** shop disappear | both React plugins declare `requiredBackendPlugins: ['catalog']` |
| `playlist` (Python) | the playlist card stays, and says so | the frontend declares it in `optionalBackendPlugins`, which never gates rendering |
| `mood` (Python) | `GET /api/playlist/rules` returns `[]` | the platform stops counting a disabled plugin's contributions |

Hovering a row opens an overlay with what that plugin says about itself — its
icon and emoji, display name, identifier, tier, description, and the plugins it
requires or merely likes on the other side of the wire. Both tiers declare the
same four presentation fields, which is why one overlay draws either.

The backend half is worth trying with `curl` too, to see that the server really
changed its mind rather than the browser hiding something:

```bash
curl -s localhost:8799/api/playlist/rules            # chill, energetic, a-to-z
curl -s localhost:8799/plugins/mood/toggle \
  -H 'content-type: application/json' -d '{"enabled": false}'
curl -s localhost:8799/api/playlist/rules            # []
```
