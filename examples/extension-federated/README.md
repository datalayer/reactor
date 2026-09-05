[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

# ⚛️ 📦 A federated extension — one `pip install`, a container inside

[`examples/extension`](../extension/) ships its frontend as a plain ES module.
This one ships a **Module Federation container**, which is what a real build
produces, and which is what lets the frontend borrow React by negotiation
rather than off a global.

```bash
pip install examples/extension-federated      # against a running host
# refresh the browser
```

Three fields on `FrontendExtension` are the whole difference:

```python
FrontendExtension(
    directory=_FRONTEND,
    entry="remoteEntry.js",
    kind="federated",
    remote_name="hello_federated",
    module="./plugin",
    ...
)
```

The server puts `kind`, `remoteName` and `module` on the wire; the browser's
`bootstrapExtensions` reads them and loads the entry through the federation
loader instead of `import()`. Same entry point, same `share/`, same install.

## The container

`share/…/hello-federated/remoteEntry.js` is written by hand so this example
runs with no build step. `frontend/` is the Rsbuild project that emits the real
one into the same directory:

```bash
cd frontend && npm install && npm run build   # -> ../share/.../hello-federated/
pip install ..                                # both halves, one wheel
```

## Developing without rebuilding the wheel

```bash
cd frontend && npm run dev                    # container on :5182, hot updates
```

Then, from the host's console:

```ts
updateFederatedRemote('hello_federated', 'http://localhost:5182/remoteEntry.js');
```

The name is pointed at the dev server; edits to `src/plugin.tsx` arrive on the
next module the container hands out. `pip install -e .` keeps the Python half
editable in the usual way.
