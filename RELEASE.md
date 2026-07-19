<!--
  ~ Copyright (c) 2024- Datalayer, Inc.
  ~
  ~ BSD 3-Clause License
-->

# Reactor Release Guide

This document describes how releases are produced for this repository.

## What Is Released

- Python package: `datalayer-reactor` to PyPI.
- TypeScript package: `@datalayer/reactor` to npm.
- GitHub Release entry for the pushed tag.

## Release Trigger

The workflow in `.github/workflows/release.yml` runs on:

- pushed tags matching `v*.*.*` (for example: `v0.1.0`)
- manual dispatch (`workflow_dispatch`)

## Versioning Rules

- Use semantic versioning.
- Keep versions aligned across:
   - `pyproject.toml` (`project.version`)
   - `package.json` (`version`)
   - tag (`vX.Y.Z`)

The release workflow validates that tag, Python version, and npm version match.

## Required Repository Configuration

### PyPI trusted publishing

In PyPI project `datalayer-reactor`:

- add GitHub Actions trusted publisher
- owner: `datalayer`
- repository: `reactor`
- workflow: `release.yml`
- environment: `pypi`

### GitHub environment

- create environment `pypi` in repository settings
- optional: add required reviewers for manual approval

### npm publish token

Add repository secret:

- `NPM_TOKEN`: npm automation token with publish access to `@datalayer/reactor`

## Release Steps

1. Update versions.

```bash
# update both files to the same version
$EDITOR pyproject.toml
$EDITOR package.json
```

2. Validate locally.

```bash
npm install
npm run typecheck
npm run build
npm run test:ts

python -m pip install -e .[dev]
pytest -q
```

3. Create and push a tag.

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. Monitor `.github/workflows/release.yml` run:

- verify verify/build/test job passes
- verify PyPI publication
- verify npm publication
- verify GitHub Release notes and links

## Rollback and Recovery

- If release fails before publish: fix and push a new tag.
- If npm publish succeeded but PyPI failed (or vice versa):
   - avoid deleting published versions unless absolutely required
   - increment patch version and publish a new tag
- If GitHub Release generation fails after packages were published:
   - rerun only the release job or create release notes manually in GitHub
