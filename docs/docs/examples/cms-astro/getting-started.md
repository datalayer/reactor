---
sidebar_position: 1
title: Run and Seed
---

# Run and seed the Astro CMS

Run these commands from the Reactor repository root:

```bash
make cms-astro-install
make cms-astro-seed
make cms-astro
```

The development environment exposes:

| Address | Purpose |
| --- | --- |
| `http://localhost:4321/` | Published Astro website |
| `http://localhost:4321/_cms/login` | CMS login and client-side administration |
| `http://localhost:8791/docs` | FastAPI/OpenAPI documentation |

`make cms-astro` starts the API on port `8791`, starts Astro on port `4321`,
and sets `CMS_API_URL` for the frontend server.

## Seeded accounts

`make cms-astro-seed` creates or refreshes one website and three accounts:

| Username | Password | Seeded site role | Access |
| --- | --- | --- | --- |
| `admin` | `admin` | `admin` | Content plus users, sites, themes and extensions |
| `user1` | `user1` | `author` | Create, edit and publish their own content |
| `user2` | `user2` | `author` | Create, edit and publish their own content |

All three accounts can open the initial **Acme Journal** site. The two author
accounts do not receive the administration navigation, and the API independently
rejects their attempts to change users, site membership or themes.

The seed is repeatable. It restores the documented passwords and roles,
invalidates sessions for the three seeded users, and leaves unrelated content
in the database intact.

To use another database:

```bash
CMS_ASTRO_DB=/tmp/my-cms.sqlite3 make cms-astro-seed
CMS_ASTRO_DB=/tmp/my-cms.sqlite3 make cms-astro
```

:::warning Development credentials
The seed passwords are intentionally memorable demonstration credentials. Do
not deploy them. Create real accounts and replace the example session policy
with the authentication requirements of your application.
:::

## Build installable wheels

```bash
make cms-astro-package
```

This produces Core, Pro and x402 wheels. The Core wheel contains the standalone
Astro build and installs two commands:

```bash
cms-astro --db ./cms.sqlite3  # API host
CMS_API_URL=http://localhost:8791 cms-astro-site  # embedded Astro server
```
