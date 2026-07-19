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
```

The two Python backends are real installable packages (each with its own
`pyproject.toml`):

```
catalog-plugin/     # music-catalog-plugin  -> catalog_plugin package
checkout-plugin/    # music-checkout-plugin -> checkout_plugin package
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
- **app** — mounts only `HeaderExtension` and `ShopExtension`; the catalog and
  checkout plugins are pulled in transitively as dependencies. The app swaps the
  main store view for the `checkout` slot while checkout is open.

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

# 2. Install the backend packages (editable). checkout depends on catalog.
pip install -e examples/music/catalog-plugin \
              -e examples/music/checkout-plugin

# 3. Start the combined backend (catalog + checkout) on port 8799
uvicorn checkout_plugin.app:app --reload --port 8799

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