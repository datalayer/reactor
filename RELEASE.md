<!--
  ~ Copyright (c) 2024- Datalayer, Inc.
  ~
  ~ BSD 3-Clause License
-->

# Reactor Release Guide

One tag releases every package in this repository, to npm and PyPI, with no
stored token: both registries trust the workflow
`.github/workflows/release.yaml` through OIDC (trusted publishing).

## What Is Released

All packages carry **one version**, the one the tag names.

npm (GitHub environment `npm`):

| Package                        | Path               |
| ------------------------------ | ------------------ |
| `@datalayer/reactor`           | `.`                |
| `@datalayer/reactor-commands`  | `plugins/commands` |
| `@datalayer/reactor-graph`     | `plugins/graph`    |
| `@datalayer/reactor-manager`   | `plugins/manager`  |
| `@datalayer/reactor-shell`     | `plugins/shell`    |

PyPI (GitHub environment `pypi`):

| Package              | Path                 | Version from                          |
| -------------------- | -------------------- | ------------------------------------- |
| `datalayer-reactor`  | `.`                  | `package.json` (hatch-nodejs-version) |
| `reactor-mcp-server` | `plugins/mcp-server` | `pyproject.toml`                      |

The examples under `examples/` and the docs are private and never published.

## Trusted Publishing Setup

Done once per package, by an owner of the registry account.

**npm** — for each of the five packages, on npmjs.com → package → Settings →
Publishing access → *Trusted publisher*:

- publisher: GitHub Actions
- organization or user: `datalayer`
- repository: `reactor`
- workflow filename: `release.yaml`
- environment name: `npm`

**PyPI** — for each of the two packages, on pypi.org → project → Publishing:

- owner: `datalayer`
- repository: `reactor`
- workflow name: `release.yaml`
- environment name: `pypi`

**GitHub** — the repository has two environments, `npm` and `pypi` (Settings →
Environments); required reviewers on them are optional and add a manual
approval before each publish.

The registry matches the repository, the workflow *filename* and the
environment exactly: renaming any of them means re-registering the publisher.

## Releasing

1. Set the version, the same everywhere, on a branch and open a pull request:

   ```bash
   # package.json and plugins/*/package.json: "version"
   # plugins/mcp-server/pyproject.toml: version
   # datalayer-reactor follows package.json by itself.
   ```

   The plugins' `"@datalayer/reactor": "^X.Y.Z"` floor and the MCP server's
   `datalayer_reactor>=X.Y.Z` floor move with it.

2. Merge, then tag the merge commit and push the tag:

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

3. The `Release` workflow checks that the tag names every package's version,
   builds and tests, packs the npm tarballs, builds the wheels and sdists, and
   publishes what is not on the registries yet — in that order, `@datalayer/reactor`
   before the plugins. A GitHub release with generated notes closes it.

Packages whose exact version is already published are skipped, so a re-run
after a partial upload, or a tag that bumps only some packages, publishes
just what is missing.

## Checking a Release

```bash
npm view @datalayer/reactor version
npm view @datalayer/reactor-shell version
curl -s https://pypi.org/pypi/datalayer-reactor/json | python -c 'import sys,json;print(json.load(sys.stdin)["info"]["version"])'
curl -s https://pypi.org/pypi/reactor-mcp-server/json | python -c 'import sys,json;print(json.load(sys.stdin)["info"]["version"])'
```
