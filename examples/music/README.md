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
  header-plugin/        # depends on catalog-plugin + shop-plugin
  shop-plugin/          # depends on catalog-plugin, owns the shared cart store
```

- **catalog-plugin** — the base plugin. Exposes the `useCatalogSongs` data hook
  and a `catalog` slot UI. Ships a FastAPI backend
  (`catalog-plugin/backend/catalog_backend.py`) serving `GET /api/catalog/songs`.
- **header-plugin** — declares `dependencies: [CatalogExtension, ShopExtension]`
  and consumes `useCatalogSongs` plus the shared cart store. Contributes the
  store header (with the theme / color-mode chooser at the top right) to the
  `header` slot, including a cart summary that reveals cart details in a Primer
  overlay on hover.
- **shop-plugin** — declares `dependencies: [CatalogExtension]` and consumes
  `useCatalogSongs`. Owns the shared `useCart` store and contributes the
  purchasable song cards + cart to the `main` slot.
- **app** — mounts only `HeaderExtension` and `ShopExtension`; the catalog plugin
  is pulled in transitively as their dependency.

## Run

The app depends on `@datalayer/reactor` via `file:../..`, which resolves to the
built `dist/`, so reactor must be built first.

```bash
# from the reactor repo root
make example-music
```

Or manually:

```bash
# 1. Build reactor
npm run build

# 2. Start the catalog FastAPI backend (port 8799)
uvicorn catalog_backend:app --app-dir examples/music/catalog-plugin/backend --reload --port 8799

# 3. Install workspaces and start the app (port 5179)
cd examples/music
npm install
npm run dev
```