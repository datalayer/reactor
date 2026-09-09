[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

# ⚛️ 🚀 Reactor Examples

## Frontend

The frontend demo at `examples/frontend/` contains two plugins:

- `@demo/welcome-card`
- `@demo/status-banner`

It renders them through `ReactorSlot` and exposes runtime enable/disable controls.

Run it:

```bash
npm install
npm run example:dev
```

Run the combined frontend-backend demo frontend:

```bash
npm run example:dev:frontend-backend
```

## Frontend + Backend

Run the Python app for the combined frontend-backend demo:

```bash
python -m uvicorn --app-dir examples/frontend-backend reactor_demo:app --reload --port 8788
```

The demo backend registers the shared example plugins (`GreetingPlugin` and
`StatusPlugin`) defined in `reactor/examples/greeting_plugin.py`.

## Federation

`examples/federation/` is a shell that loads plugins from URLs: a plain remote,
a remote that fails on purpose, a box to install one by URL into the running
platform, and a **Module Federation container** with a button that hot-updates
it. `examples/federation/remote-charts/` is that container as an Rsbuild build.

```bash
cd examples/federation && npm install && npm run dev     # http://localhost:5180
```

## Extensions — one `pip install`, both tiers

- `examples/extension/` — a Python plugin and a plain ES-module frontend in one
  wheel, no build step.
- `examples/extension-federated/` — the same, with the frontend shipped as a
  Module Federation container; `frontend/` builds it into `share/`.
- `examples/extension-template/` — the layout with the names left blank, and a
  script that fills them: `python examples/extension-template/new-extension.py acme-charts ~/src/acme-charts`.

