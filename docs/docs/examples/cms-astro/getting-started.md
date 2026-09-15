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

The install target supports both repository layouts. In the full Datalayer
monorepo it reuses the root npm workspace links, so the CMS consumes the local
`@datalayer/jupyter-lexical` package and its matching Lexical dependencies. In
a standalone Reactor checkout it installs the published frontend dependencies
locally. The Astro configuration selects the corresponding dependency graph so
the editor never mixes incompatible Lexical runtimes.

## Seeded accounts

`make cms-astro-seed` creates or refreshes one website and three accounts:

| Username | Password | Seeded site role | Access |
| --- | --- | --- | --- |
| `admin` | `admin` | `admin` | Content plus users, sites, site appearance and extensions |
| `user1` | `user1` | `author` | Create, edit and publish their own content |
| `user2` | `user2` | `author` | Create, edit and publish their own content |

All three accounts can open the initial **Acme Journal** site. The two author
accounts do not receive the administration navigation, and the API independently
rejects their attempts to change users, site membership or themes.

The seed creates four published stories with different authors, categories,
lengths, and one featured story. This makes the layout choice easy to evaluate:
Editorial presents a prominent lead story, while Studio presents the same
content as a compact numbered grid.

The seed is safely repeatable. When the database already contains CMS records,
`make cms-astro-seed` reports its site, user, and entry counts and asks before
removing **all** CMS data. Answering anything other than `y` or `yes` leaves the
database unchanged. For deliberate non-interactive resets, run the seed module
with `--yes`.

## Explore the example

After signing in as `admin`:

1. Open **Content**. The first of four seeded entries is selected automatically.
   The editor stores both rich Lexical JSON and a plain-text projection.
2. Open **Sites**, edit **Acme Journal**, and select **Appearance**. Choose a
   Datalayer theme card, an Astro layout, and a color mode. The homepage preview
   updates before you save.
3. Save the appearance and open the visitor website. The colors, font stacks,
   color mode, and Astro layout apply to `/`, `/blog`, and post pages. Switching
   from Editorial to Studio changes the lead-story layout into a numbered,
   three-column grid in the live preview and visitor site.

Sign in as `user1` or `user2` to verify the author experience. Authors can see
all Acme Journal entries but can edit and publish only content they own; other
entries open read-only. They do not receive the administrator navigation or CRUD
screens.

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

This produces Core, AI Agents, Pro and x402 wheels. The Core wheel contains the standalone
Astro build and installs two commands:

```bash
cms-astro --db ./cms.sqlite3  # API host
CMS_API_URL=http://localhost:8791 cms-astro-site  # embedded Astro server
```
