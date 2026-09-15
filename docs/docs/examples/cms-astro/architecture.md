---
sidebar_position: 2
title: Architecture
---

# Architecture

The browser, Astro server and Python server have distinct responsibilities:

```text
Browser
  ├── Primer + Jupyter Lexical React application under /_cms/*
          │ bearer token and CMS requests
          ▼
FastAPI + Reactor host ───────► SQLite
          ▲                     users, sites, entries, revisions,
          │ published JSON      themes, media, menus and search
Astro SSR server
  └── live content loader ─────► public website response
  └── generic public extension host
          │ discovers optional AI Agents wheel
          ▼
      authenticated ChatFloating
          │ anonymous inference key + public crawl results
          ▼
      browser agent loop
```

The two credentials have deliberately separate authority. The anonymous key
can call only the inference service and expires visibly in the chat header. The
CMS bearer token authorizes site-scoped crawl and content requests; it is never
used as the model credential.

## Core is the application package

`core/pyproject.toml` registers `cms_astro_core:extension` under
`datalayer.reactor.extensions`. Its wheel contains:

1. the Python API and SQLite store;
2. the Core browser plugin under
   `share/datalayer/reactor/extensions/cms-astro-core`;
3. the built Astro server under
   `share/datalayer/reactor/apps/cms-astro`.

This is the [Python-packaged extension](/python-packaged-extensions/) pattern:
one installation delivers both tiers, while Reactor still discovers the Core
plugin through the same public mechanism used for third-party extensions.

AI support follows that mechanism independently. `ai-agents/pyproject.toml`
packages its Python plugin, Reactor `AgentTools` contract, and built frontend
under `share/datalayer/reactor/extensions/cms-astro-ai-agents`. Core supplies
only a generic public-extension host, so installing or removing AI Agents does
not change or rebuild the CMS application.

## Astro live content

`frontend/src/live.config.ts` defines `posts` and `pages` using the local
`cmsLoader`. The loader implements Astro's `LiveLoader` contract:

```ts
export const collections = {
  posts: defineLiveCollection({
    loader: cmsLoader({ apiUrl, site, collection: 'posts' }),
  }),
  pages: defineLiveCollection({
    loader: cmsLoader({ apiUrl, site, collection: 'pages' }),
  }),
};
```

Collection and entry reads happen during the request. The loader returns cache
tags for the site, collection and entry, and the public API filters to
`status='published'` before Astro sees the records.

The Astro site owns routes and layouts. The CMS does not generate a theme
project; it stores the selected appearance and its design tokens so the Astro
layout can decide how to render them.

### Portable appearance tokens

Primer Addons exposes `exportPortableTheme`, which turns a Datalayer theme into
a JSON-safe contract containing light and dark maps of CSS custom properties.
Keys retain Primer's functional and component token names, such as
`--bgColor-default`, `--fgColor-muted`, `--borderColor-default`, and
`--button-primary-bgColor-rest`. The contract also carries typography through
`--fontStack-sansSerif`, `--fontStack-sansSerifDisplay`, and
`--fontStack-system`, so custom themes such as Spatial do not inherit an
unrelated Astro font.

The selected Datalayer theme, color mode, and both maps are persisted in SQLite.
Astro places `data-color-mode`, `data-light-theme`, and `data-dark-theme` on the
root element and emits the variables for light, dark, or operating-system mode.
`Base.astro` consumes the functional color and font-stack variables directly.
The same serialized contract can therefore be consumed by another renderer
without React, Primer, or Astro being present at runtime. It is also the shared
boundary for the project's migration toward Primer CSS variables rather than an
Astro-specific theme format.

Astro's theme gallery contains complete starter templates rather than a
runtime palette API. Those templates can still supply alternative layouts, but
the portable Primer variables are the stable appearance boundary shared across
layouts and frameworks.

The site editor therefore exposes one website appearance assembled from
separate, clearly labelled concerns:

- **Datalayer theme** selects the portable colors and typeface;
- **Astro layout** selects page composition without resetting the theme; and
- **Color mode** selects light, dark, or the visitor's operating-system
  preference.

An iframe previews the selected site's homepage before saving. The appearance
endpoint persists the theme, color mode, light/dark token maps, and layout in one
operation, so the visitor site changes atomically. Reactor extensions may add
Astro layouts without changing Core.

## Rich editor composition

The CMS depends directly on `@datalayer/jupyter-lexical` but owns its editor
composition. It imports the shared toolbar and plugins for component insertion,
tables and cell resizing, table actions, code actions, comments, draggable
blocks, links, floating formatting, and a table of contents. Runtime/kernel and
collaborative editing plugins are deliberately omitted because this example
does not provision their backing services.

Lexical JSON is stored as the canonical rich representation and a plain-text
projection is stored alongside it for search, simple Astro rendering, and
extension interoperability.

## SQLite model

One database stores multiple sites. A membership joins one user to one site
with `viewer`, `author`, `editor` or `admin` access. Entries are site- and
collection-scoped, and publishing captures an immutable revision before the
status changes.

SQLite FTS5 indexes title, excerpt and body. Lexical's serialized editor state
is kept in the entry's structured `data`, while a plain-text projection is kept
in `body` for search and non-editor consumers.

## UI and extension boundary

The React application uses Primer React inside the Primer Addons `ThemedProvider`.
The host publishes React, Reactor, Primer React and Primer Addons through
`setReactorSharedModules`, allowing dynamically loaded extension JavaScript to
reuse the host's runtime and design system instead of bundling a second copy.

See [cross-tier dependencies](/cross-tier-dependencies/) for the declarations
that connect the Python and browser plugin halves.
