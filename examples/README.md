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
python -m uvicorn --app-dir examples/frontend-backend python_reactor_demo:app --reload --port 8788
```

The demo backend registers the shared example plugins (`GreetingPlugin` and
`StatusPlugin`) defined in `datalayer_reactor/examples/greeting_plugin.py`.
