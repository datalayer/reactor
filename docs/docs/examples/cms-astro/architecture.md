---
sidebar_position: 2
title: Architecture
---

# Architecture

The browser, Astro server and Python server have distinct responsibilities:

```text
Browser
  └── Primer + Lexical React application under /_cms/*
          │ bearer token and CMS requests
          ▼
FastAPI + Reactor host ───────► SQLite
          ▲                     users, sites, entries, revisions,
          │ published JSON      themes, media, menus and search
Astro SSR server
  └── live content loader ─────► public website response
```

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
project; it stores the selected theme and its design tokens so the Astro layout
can decide how to render them.

### Portable appearance tokens

Primer Addons already exposes each palette's `themeStyles` as CSS custom
properties. The CMS converts that object into a JSON-safe contract containing
light and dark maps without adding an Astro or serialization dependency to
Primer Addons. Keys retain Primer's functional and component token names, such
as `--bgColor-default`, `--fgColor-muted`, `--borderColor-default`, and
`--button-primary-bgColor-rest`.

The selected theme, color mode, and both maps are persisted in SQLite. Astro
places `data-color-mode`, `data-light-theme`, and `data-dark-theme` on the root
element and emits the variables for light, dark, or operating-system mode. The
public layout consumes the functional variables directly. The same serialized
contract can therefore be consumed by another renderer without React, Primer,
or Astro being present at runtime.

Astro's theme gallery contains complete starter templates rather than a
runtime palette API. Those templates can still supply alternative layouts, but
the portable Primer variables are the stable appearance boundary shared across
layouts and frameworks.

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
