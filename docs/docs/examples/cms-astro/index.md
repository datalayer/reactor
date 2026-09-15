---
sidebar_position: 0
title: Astro CMS
slug: /examples/cms-astro/
---

# 🪐 The Astro CMS example

`examples/cms-astro` is a multi-user, multi-site content management system that
combines four ideas in one installable example:

- an Astro SSR website using live content collections;
- a FastAPI API backed by SQLite;
- a Primer React administration interface with a rich editor composed from
  `@datalayer/jupyter-lexical`;
- Reactor extensions discovered from Python packages, including optional Pro
  and x402 packages.

Core owns both the Python host and the Astro application. There is no separate
application package to coordinate: the built Astro server is copied into the
Core wheel beside the browser half of its Reactor extension.

```text
cms-astro/
├── core/
│   ├── cms_astro_core/       Python host, API, auth, database and seed command
│   ├── frontend/             Astro SSR application and Primer React admin
│   └── share/datalayer/      embedded Reactor frontend extension
├── pro/                      optional editorial extension
├── x402/                     optional paid-content extension
└── tests/                    API, authorization and x402 acceptance tests
```

## What it demonstrates

| Concern | Implementation |
| --- | --- |
| Content | Database-defined collections, drafts, publishing and revisions |
| Tenancy | Multiple sites with a role per user and site |
| Rendering | Astro 6 live collections loaded at request time |
| Administration | A client-side React application under `/_cms/*`, drawn with Primer |
| Authoring | CMS-owned Jupyter Lexical composition with a rich toolbar and plugins, structured JSON, and a plain-text projection |
| Appearance | Portable Datalayer themes, Astro layouts, color modes, and a live homepage preview |
| Authentication | PBKDF2 password hashes and expiring bearer sessions |
| Discovery | Python entry points under `datalayer.reactor.extensions` |
| Optional capabilities | Independently installable Pro and x402 wheels |

The public website reads only published entries. Drafts and revisions remain
behind the authenticated CMS API.

## Read on

| Page | What it covers |
| --- | --- |
| [Run and seed the example](/examples/cms-astro/getting-started) | Commands, URLs and demo accounts |
| [Architecture](/examples/cms-astro/architecture) | Astro, SQLite and the Python-packaged frontend |
| [Users and authoring](/examples/cms-astro/users-and-authoring) | Site roles, API enforcement and Lexical storage |
| [Pro and x402 extensions](/examples/cms-astro/extensions) | Runtime discovery and paid routes |

The implementation README is also available at
`examples/cms-astro/README.md` in the repository.
