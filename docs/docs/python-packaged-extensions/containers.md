---
sidebar_position: 1
title: Shipping a Container
---

# Shipping a container

A plain `index.js` is enough to prove the chain and not enough for a real
frontend: one that has chunks, or that wants React by version rather than off
a global. For that the frontend half is a **Module Federation container**, and
three fields say so:

```python
FrontendExtension(
    directory=_FRONTEND,
    entry="remoteEntry.js",          # the container entry a bundler emits
    kind="federated",                # not "esm"
    remote_name="acme_charts",       # the container's name — `name` in the build
    module="./plugin",               # what it exposes
    plugins=[FrontendPlugin(name="@acme/charts")],
)
```

`GET /plugins/frontend-extensions` puts `kind`, `remoteName`, `module` (and an
optional `remoteType`, for a hand-written ES-module entry) on the wire, and
`bootstrapExtensions` loads that extension through
[`defineFederatedPlugin`](/typescript-plugins/federation#containers) instead
of `import()`. Same entry point, same `share/`, same one `pip install`.

## Building into the wheel

The build writes straight into `share/`, so the two halves cannot drift:

```ts
// frontend/rsbuild.config.ts
pluginModuleFederation({
  name: 'acme_charts',                              // == remote_name
  filename: 'remoteEntry.js',                       // == entry; the default is hashed
  exposes: { './plugin': './src/plugin.tsx' },        // key == module
  shared: { react: { singleton: true, requiredVersion: '^19.0.0' }, '@datalayer/reactor': { singleton: true } },
  dts: true,
}),
output: {
  assetPrefix: 'auto',
  cleanDistPath: true,                              // this build's chunks, none of the last one's
  distPath: { root: '../share/datalayer/reactor/extensions/acme-charts' },
  copy: [{ from: './package.json' }],               // the version it was built at
}
```

```bash
(cd frontend && npm run build)   # remoteEntry.js + chunks -> share/
pip install .                    # one wheel, both halves, one version
```

`assetPrefix: 'auto'` is what lets the entry's chunks resolve from wherever
the entry was served — which, in a wheel, is `/reactor-extensions/{name}/`.

## Developing without rebuilding the wheel

An editable install has to keep working, and it does, in two halves:

```bash
pip install -e .                 # the Python half, editable as usual
(cd frontend && npm run dev)     # the container on a dev server, hot updates
```

Then point the running host at the dev server once, from its console:

```ts
setAllowedOrigins(['http://localhost:5182']);
updateFederatedRemote('acme_charts', 'http://localhost:5182/remoteEntry.js');
```

Edits to the TSX arrive on the next module the container hands out. No wheel
is rebuilt and nothing restarts.

The first line is not boilerplate. A hot update points a name the host already
trusts at a URL that came from a person, which makes it the *easiest* of these
seams to turn into a way in — so it goes through the same gate as everything
else. A dev server on another port is another origin, and saying so once is
what the gate asks for. See [Allowed origins](/typescript-plugins/allowed-origins).

`copy` is what makes the version check possible: the Python half declares the
version its frontend must be (`FrontendExtension(version=…)`) and a build that
records another is refused — see
[One version, checked](/python-packaged-extensions/#one-version-checked).

## Starting one outside this repository

[`examples/extension-template`](https://github.com/datalayer/reactor/tree/main/examples/extension-template)
is the layout above with the names left blank and a script that fills them:

```bash
python examples/extension-template/new-extension.py acme-charts ~/src/acme-charts
cd ~/src/acme-charts
(cd frontend && npm install && npm run build)   # the container, into share/
pip install .                                    # both halves, one wheel
```

It copies a directory and substitutes three placeholders. What comes out is a
plain project you own, comments included, with one version written once — in
`frontend/package.json`, which `pyproject.toml` reads through
`hatch-nodejs-version`. Its
[README](https://github.com/datalayer/reactor/tree/main/examples/extension-template#readme)
walks a newcomer from nothing to the panel in a browser, including which names
must agree across the two languages and what a host page needs to load a
container (`setFederationRuntime`).

The template is under test: `tests/test_extension_template.py` generates one,
builds its wheel with its own `pyproject.toml`, installs it and serves it, and
`examples/extension-template/template.test.ts` runs its frontend plugin.
