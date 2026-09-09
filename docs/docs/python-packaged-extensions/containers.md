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
  exposes: { './plugin': './src/plugin.tsx' },
  shared: { react: { singleton: true, requiredVersion: '^19.0.0' }, '@datalayer/reactor': { singleton: true } },
  dts: true,
}),
output: { assetPrefix: 'auto', distPath: { root: '../share/datalayer/reactor/extensions/acme-charts' } }
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

## Starting one outside this repository

[`examples/extension-template`](https://github.com/datalayer/reactor/tree/main/examples/extension-template)
is the layout above with the names left blank and a script that fills them:

```bash
python examples/extension-template/new-extension.py acme-charts ~/src/acme-charts
```

It copies a directory and substitutes three placeholders. What comes out is a
plain project you own, comments included.
