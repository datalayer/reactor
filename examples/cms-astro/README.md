[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

# Reactor CMS for Astro

An Astro-native, SQLite-backed CMS example whose features are delivered as
Python-packaged Reactor extensions. It follows EmDash's useful separation:
Astro owns routes, layouts and rendering; the CMS owns structured content,
editorial workflow and administration.

## What ships

- Multiple users with per-site `admin`, `editor`, `author`, and `viewer` roles.
- Multiple sites in one SQLite database.
- Database-defined collections and typed fields.
- Draft, review, scheduled and published states, immutable revisions, previews,
  and SQLite FTS5 search.
- Media metadata, taxonomies, nested terms, menus, menu items, widget areas and
  site settings.
- Multiple installable themes per site. Themes remain Astro projects; the CMS
  stores the active layout plus a portable Primer CSS-variable palette for
  light, dark, and operating-system color modes.
- Astro 6 live content collections backed by the published-content API, with
  request-time loading and cache tags.
- A responsive, client-side React administration application with Primer
  React, `ThemedProvider`, and the Primer Addons appearance store used by the
  Reactor music example.
- Lexical rich-text authoring with persisted editor JSON and plain-text search.
- An authenticated AI author on the published Astro pages. `ChatFloating`
  runs the `worker-cms-astro` loop in the browser with a short-lived anonymous
  inference key and CMS-session-scoped frontend tools for public blog crawling,
  WordPress REST discovery, and draft/publish operations.
- Core, AI Agents, Pro, and x402 wheels discovered through `datalayer.reactor.extensions`; each
  carries its browser plugin under `share/datalayer/reactor/extensions/`.
- An optional x402 extension with HTTP `402`, `PAYMENT-REQUIRED`, and
  `PAYMENT-RESPONSE` handling for paid Astro routes.

The example uses PBKDF2 password hashes and expiring bearer sessions. The
`X-CMS-User` shortcut is available only when a host explicitly enables it for
isolated tests.

## Layout

```text
cms-astro/
  core/                 installable host + Astro SSR site + Core extension
    frontend/           Astro routes, live loader and Primer React admin
  ai-agents/            optional AI agent Python/JavaScript extension
  pro/                  separately installable Pro Python/JavaScript extension
  x402/                 separately installable paid-content extension
  tests/                database and HTTP acceptance tests
```

## Run

From the Reactor monorepo root:

```bash
make cms-astro-install       # Core, editable from this checkout
make cms-astro-seed          # demo site + admin/admin, user1/user1, user2/user2
make cms-astro               # backend + Astro development server
make cms-astro-ai            # optional authenticated AI authoring extension
make cms-astro-pro           # optional, in another terminal
make cms-astro-x402          # optional paid-content extension
make cms-astro-package       # local Core, AI Agents, Pro, and x402 wheels
```

In the full Datalayer monorepo, `cms-astro-install` reuses the root npm
workspace links (including the local `@datalayer/jupyter-lexical` checkout) and
does not create a second dependency tree below the frontend. In a standalone
Reactor checkout, the same target installs the published dependencies locally
with npm. The Astro Vite configuration follows the same rule, keeping all
Lexical packages on one compatible runtime in either layout.

The standalone console command remains available as
`cms-astro --db ./cms-astro.sqlite3`. A built Core wheel also installs
`cms-astro-site`; run it in a second terminal with `CMS_API_URL` pointing at
the backend to serve the wheel-embedded Astro application.

Open the API documentation at <http://localhost:8791/docs>. The seeded logins
are `admin/admin`, `user1/user1`, and `user2/user2`. Admin manages sites,
themes, extensions, users, and roles. User1 and user2 are content authors on
the initial Acme Journal site and cannot reach those administrative APIs.
The client-side administration UI starts at <http://localhost:4321/_cms/login>
and exposes history-aware React routes under `/_cms/content`, `/_cms/users`,
`/_cms/sites`, `/_cms/appearance`, and `/_cms/extensions`. Astro provides only
the thin application mount for these routes; it renders the public content pages.
Install the optional agent with `make cms-astro-ai`. After login, return to the
published website to see the floating **Astro CMS Author**. The public site
discovers its embedded JavaScript at runtime; Core does not depend on the AI
runtime packages. Anonymous visitors do not load or see the agent. Its header displays
the anonymous inference-key timer; CMS writes still use the signed-in user's
bearer session and are checked against the active site's role.
Its Appearance section uses Primer Addons to select the personal Primer theme
and light, dark, or system color mode, while site administrators can separately
choose the active public website theme. The same Appearance experience is
available while editing an individual website alongside its general settings.

Install Pro while the host is running, then refresh the browser extension list:

```bash
pip install examples/cms-astro/ai-agents
pip install examples/cms-astro/pro
pip install examples/cms-astro/x402
```

Build the AI frontend first with `make cms-astro-ai-build`; the combined
`make cms-astro-ai` target performs both the frontend build and installation.

`make cms-astro` sets `CMS_API_URL` for the Astro server automatically.

Paid routes call `Astro.locals.x402(...)`, populated by the included Astro
middleware. The x402 package includes a deterministic HMAC payment signature
for local testing; production deployments should connect the same extension
boundary to a real x402 facilitator.


## API highlights

| Endpoint | Purpose |
| --- | --- |
| `POST /api/cms/auth/login` | Password login and bearer session creation |
| `GET /api/cms/sites` | Sites visible to the current user |
| `GET /api/cms/sites/{site}/users` | Site-scoped user and role listing |
| `PATCH /api/cms/sites/{site}/users/{user}` | Edit profile, credentials, or status |
| `DELETE /api/cms/sites/{site}/users/{user}` | Remove site access and orphaned accounts |
| `GET/POST /api/cms/sites/{site}/entries` | Editorial content management |
| `POST /api/cms/sites/{site}/crawl/blog` | Extract pages linked by a public blog index |
| `POST /api/cms/sites/{site}/crawl/wordpress` | Discover and read a public WordPress REST feed |
| `PATCH /api/cms/sites/{site}/entries/by-slug/{slug}` | Update an exact entry without listing private content |
| `POST /api/cms/sites/{site}/entries/{id}/publish` | Publish with a revision |
| `GET /api/cms/sites/{site}/search?q=...` | FTS5 search |
| `GET /api/content/{site}/entries` | Published content for Astro |
| `GET /api/content/{site}/entries/{slug}` | One published entry |
| `GET /api/content/{site}/bootstrap` | Settings, theme, menus and widgets |

The schema is initialized transactionally. The seed creates four contrasting
stories so the Editorial lead-story composition and the denser Studio grid are
immediately visible. If CMS data already exists, the command asks before
removing all users, sites, content, themes and related records and rebuilding
the demo. Pass `--yes` to the Python seed command for an explicit non-interactive
reset. Foreign keys, site-scoped uniqueness, membership checks and ownership
rules are enforced on the server.
