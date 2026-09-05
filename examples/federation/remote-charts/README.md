[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

# ⚛️ Remote Charts — a container, built

The parent example loads `@remote/charts` from a container that was
[written by hand](../public/remotes/charts/remoteEntry.js), so the protocol is
readable. This directory is the same plugin built the real way, with Rsbuild's
Module Federation plugin.

```bash
npm install
npm run build          # dist/remoteEntry.js + chunks + @mf-types/
npm run dev            # serves the container on http://localhost:5181
```

Point the parent example at it by changing `CHARTS_ENTRY` in `src/App.tsx` to
`http://localhost:5181/remoteEntry.js` and adding that origin to
`allowedOrigins` — and drop `type: 'esm'`, since a built entry is a `global`
script, which is the runtime's default.

What the build adds over the hand-written file:

- **`shared` with `requiredVersion`.** The container states it was built against
  `react@^19`; the host answers with what it has. A mismatch is refused by name,
  not discovered as a broken hook.
- **Type hints.** `dts: true` emits `@mf-types/`, so a host that consumes this
  container can type `loadRemote<typeof import('reactor_charts/plugin')>()`.
- **Chunks.** A real plugin is rarely one file. `assetPrefix: 'auto'` makes the
  entry's chunks resolve from wherever the entry was served — a dev server here,
  `share/` inside a wheel in the [federated extension](../../extension-federated/).
