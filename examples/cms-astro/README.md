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
  stores the active theme and its design tokens.
- Astro 6 live content collections backed by the published-content API, with
  request-time loading and cache tags.
- A responsive Astro admin route implemented as a React island with locally
  owned shadcn-style components, Tailwind tokens, and appearance controls.
- Core, Pro, and x402 wheels discovered through `datalayer.reactor.extensions`; each
  carries its browser plugin under `share/datalayer/reactor/extensions/`.
- An optional x402 extension with HTTP `402`, `PAYMENT-REQUIRED`, and
  `PAYMENT-RESPONSE` handling for paid Astro routes.

The example intentionally uses a simple development identity header,
`X-CMS-User`. It demonstrates authorization and tenancy, not production login.
Replace it with passkeys/OAuth/session middleware before deployment.

## Layout

```text
cms-astro/
  core/                 installable host + Astro SSR site + Core extension
    frontend/           Astro routes, live loader and shadcn React admin
  pro/                  separately installable Pro Python/JavaScript extension
  x402/                 separately installable paid-content extension
  tests/                database and HTTP acceptance tests
```

## Run

From the Reactor monorepo root:

```bash
make cms-astro-install       # Core, editable from this checkout
make cms-astro               # backend + Astro development server
make cms-astro-pro           # optional, in another terminal
make cms-astro-x402          # optional paid-content extension
make cms-astro-package       # local Core, Pro, and x402 wheels
```

The standalone console command remains available as
`cms-astro --db ./cms-astro.sqlite3`. A built Core wheel also installs
`cms-astro-site`; run it in a second terminal with `CMS_API_URL` pointing at
the backend to serve the wheel-embedded Astro application.

Open the API documentation at <http://localhost:8791/docs>. The seed users are
`u-admin`, `u-editor`, and `u-author`; send one as `X-CMS-User` to admin routes.
The administration UI is at <http://localhost:4321/_cms/admin>.

Install Pro while the host is running, then refresh the browser extension list:

```bash
pip install examples/cms-astro/pro
pip install examples/cms-astro/x402
```

`make cms-astro` sets `CMS_API_URL` for the Astro server automatically.

Paid routes call `Astro.locals.x402(...)`, populated by the included Astro
middleware. The x402 package includes a deterministic HMAC payment signature
for local testing; production deployments should connect the same extension
boundary to a real x402 facilitator.


## API highlights

| Endpoint | Purpose |
| --- | --- |
| `GET /api/cms/sites` | Sites visible to the current user |
| `GET /api/cms/sites/{site}/users` | Site-scoped user and role listing |
| `PATCH /api/cms/sites/{site}/users/{user}` | Enable, disable, or rename a user |
| `GET/POST /api/cms/sites/{site}/entries` | Editorial content management |
| `POST /api/cms/sites/{site}/entries/{id}/publish` | Publish with a revision |
| `GET /api/cms/sites/{site}/search?q=...` | FTS5 search |
| `GET /api/content/{site}/entries` | Published content for Astro |
| `GET /api/content/{site}/entries/{slug}` | One published entry |
| `GET /api/content/{site}/bootstrap` | Settings, theme, menus and widgets |

The schema is initialized transactionally and seeded only when empty. Foreign
keys, site-scoped uniqueness, membership checks and ownership rules are enforced
on the server.
